import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { StockService } from '../../inventory/services/stock.service.js';
import { SequenceService } from '../../inventory/services/sequence.service.js';
import { RegisterSessionService } from './register-session.service.js';
import { CreateSalesReturnDto, SalesReturnQueryDto } from '../dto/sales-return.dto.js';
import { Prisma } from '../../../generated/prisma/client.js';

export interface UserRoleContext {
  code: string;
  name: string;
  permissions: string[];
}

@Injectable()
export class SalesReturnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
    private readonly sequenceService: SequenceService,
    private readonly registerSessionService: RegisterSessionService,
  ) {}

  /**
   * Main entry point to create a Sales Return in ONE atomic transaction.
   */
  async createReturn(
    businessId: string,
    currentBranchId: string,
    userId: string,
    dto: CreateSalesReturnDto,
    userRole?: UserRoleContext,
  ) {
    // 0. Idempotency Check
    const existingReturn = await this.prisma.salesReturn.findFirst({
      where: {
        business_id: businessId,
        idempotency_key: dto.idempotencyKey,
      },
      include: {
        items: true,
      },
    });

    if (existingReturn) {
      return existingReturn;
    }

    return this.prisma.$transaction(
      async (tx) => {
        return this.processReturnLogicTx(
          tx,
          businessId,
          currentBranchId,
          userId,
          dto,
          userRole,
        );
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  /**
   * Reusable transactional core logic for Sales Return.
   * Can be invoked directly by ExchangeService within a shared transaction.
   */
  async processReturnLogicTx(
    tx: Prisma.TransactionClient,
    businessId: string,
    currentBranchId: string,
    userId: string,
    dto: CreateSalesReturnDto,
    userRole?: UserRoleContext,
  ) {
    // 1. Find original Sale
    const sale = await tx.sale.findFirst({
      where: {
        business_id: businessId,
        ...(dto.saleId ? { id: dto.saleId } : { invoice_no: dto.invoiceNo }),
      },
      include: {
        items: true,
        customer: true,
      },
    });

    if (!sale) {
      throw new NotFoundException(
        `Original sale not found with identifier "${dto.saleId || dto.invoiceNo}".`,
      );
    }

    // 2. VOIDED sales cannot be returned
    if (sale.status === 'VOIDED') {
      throw new BadRequestException('Cannot process return against a VOIDED invoice.');
    }

    // 3. Return Window Check (default 30 days, 0 = unlimited)
    const windowSetting = await tx.systemSetting.findUnique({
      where: { key: 'return_window_days' },
    });
    const returnWindowDays = windowSetting ? Number(windowSetting.value) : 30;

    if (returnWindowDays > 0) {
      const msDiff = Date.now() - new Date(sale.sale_date).getTime();
      const daysDiff = msDiff / (1000 * 60 * 60 * 24);
      if (daysDiff > returnWindowDays) {
        throw new BadRequestException(
          `Return window of ${returnWindowDays} days has expired for this invoice (Purchased ${Math.floor(daysDiff)} days ago).`,
        );
      }
    }

    // 4. Branch Rule: Cross-Branch vs Same Branch
    const isCrossBranch = sale.branch_id !== currentBranchId;
    if (isCrossBranch) {
      const hasCrossBranchPerm =
        userRole?.permissions.includes('*') ||
        userRole?.permissions.includes('return.cross_branch') ||
        userRole?.permissions.includes('return:cross_branch') ||
        userRole?.permissions.includes('sale:cross_branch') ||
        userRole?.permissions.includes('sales:cross_branch');

      if (!hasCrossBranchPerm) {
        throw new ForbiddenException(
          'Cross-branch return rejected. Missing permission "return.cross_branch".',
        );
      }
    }

    // 5. STORE_CREDIT is NOT supported (no schema for it)
    if (dto.refundMethod === 'STORE_CREDIT') {
      throw new BadRequestException(
        'STORE_CREDIT refund method is not supported (no schema for store credit). TODO: Implement StoreCredit ledger.',
      );
    }

    // 6. Lock SaleItem rows to prevent concurrent over-return
    const saleItemIds = dto.items.map((i) => i.saleItemId);
    await tx.$queryRaw`
      SELECT id FROM sale_items
      WHERE id = ANY(${saleItemIds}::uuid[])
      FOR UPDATE
    `;

    // Re-fetch sale items to read latest returned_qty
    const freshSaleItems = await tx.saleItem.findMany({
      where: {
        id: { in: saleItemIds },
        sale_id: sale.id,
      },
    });

    const saleItemMap = new Map(freshSaleItems.map((item) => [item.id, item]));

    // 7. Validate quantities and compute refund amounts per item
    let totalRefundAmount = new Prisma.Decimal(0);
    const returnItemsToCreate: Array<{
      saleItemId: string;
      variantId: string;
      quantity: Prisma.Decimal;
      refundPrice: Prisma.Decimal;
      unitCost: Prisma.Decimal;
      totalRefund: Prisma.Decimal;
      condition: 'RESELLABLE' | 'DAMAGED';
      trackedUnitBarcodes?: string[];
    }> = [];

    for (const reqItem of dto.items) {
      const saleItem = saleItemMap.get(reqItem.saleItemId);
      if (!saleItem) {
        throw new BadRequestException(
          `Sale item "${reqItem.saleItemId}" does not belong to sale "${sale.invoice_no}".`,
        );
      }

      const requestedQty = new Prisma.Decimal(reqItem.quantity);
      const remainingAvailableQty = new Prisma.Decimal(saleItem.quantity).minus(
        saleItem.returned_qty,
      );

      if (requestedQty.greaterThan(remainingAvailableQty)) {
        throw new BadRequestException(
          `Return quantity (${requestedQty}) exceeds returnable remaining quantity (${remainingAvailableQty}) for item "${saleItem.id}".`,
        );
      }

      // Refund price per unit = total_amount / quantity (customer paid after item discount + proportional bill discount)
      const refundPricePerUnit = new Prisma.Decimal(saleItem.total_amount)
        .dividedBy(saleItem.quantity)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

      const itemTotalRefund = refundPricePerUnit
        .times(requestedQty)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

      totalRefundAmount = totalRefundAmount.plus(itemTotalRefund);

      returnItemsToCreate.push({
        saleItemId: saleItem.id,
        variantId: saleItem.product_variant_id,
        quantity: requestedQty,
        refundPrice: refundPricePerUnit,
        unitCost: new Prisma.Decimal(saleItem.unit_cost),
        totalRefund: itemTotalRefund,
        condition: reqItem.condition || 'RESELLABLE',
        trackedUnitBarcodes: reqItem.trackedUnitBarcodes,
      });
    }

    // 8. Money Allocation:
    // If original sale has due_amount > 0, the refund FIRST reduces sale's due_amount & customer.current_due.
    // Only the remaining refund is paid out via refund_method.
    const saleDue = new Prisma.Decimal(sale.due_amount);
    const dueReduction = Prisma.Decimal.min(saleDue, totalRefundAmount);
    const payoutAmount = totalRefundAmount.minus(dueReduction);

    let activeSessionId: string | null = null;

    // Cash refund check: if payoutAmount > 0 and refund_method is CASH (or ADJUSTED_IN_EXCHANGE handled later), require OPEN session
    if (
      payoutAmount.greaterThan(0) &&
      dto.refundMethod === 'CASH'
    ) {
      const session = await this.registerSessionService.validateActiveSession(
        businessId,
        currentBranchId,
        userId,
      );
      activeSessionId = session.id;
    } else {
      // If cashier has an open session, link it for session tracking
      const userSession = await tx.registerSession.findFirst({
        where: {
          business_id: businessId,
          branch_id: currentBranchId,
          user_id: userId,
          status: 'OPEN',
        },
      });
      if (userSession) {
        activeSessionId = userSession.id;
      }
    }

    // 9. Update Sale due_amount, paid_amount, status
    const newSaleDue = saleDue.minus(dueReduction);
    const newSalePaid = new Prisma.Decimal(sale.paid_amount).minus(payoutAmount);

    // Update Customer current_due if due was reduced
    if (dueReduction.greaterThan(0) && sale.customer_id) {
      await tx.customer.update({
        where: { id: sale.customer_id },
        data: {
          current_due: {
            decrement: dueReduction,
          },
        },
      });
    }

    // 10. Stock Movements: RESELLABLE vs DAMAGED
    for (const rItem of returnItemsToCreate) {
      if (rItem.condition === 'RESELLABLE') {
        // Stock-in to accepting branch at original unit_cost
        await this.stockService.applyMovement(tx, {
          businessId,
          branchId: currentBranchId,
          variantId: rItem.variantId,
          movementType: 'SALE_RETURN',
          quantity: rItem.quantity,
          unitCost: rItem.unitCost,
          referenceType: 'RETURN',
          referenceId: sale.id,
          createdBy: userId,
          remarks: `Sales return against ${sale.invoice_no}${isCrossBranch ? ' (Cross-branch)' : ''}`,
        });
      } else {
        // DAMAGED: Not sellable.
        // Step a: SALE_RETURN stock-in
        await this.stockService.applyMovement(tx, {
          businessId,
          branchId: currentBranchId,
          variantId: rItem.variantId,
          movementType: 'SALE_RETURN',
          quantity: rItem.quantity,
          unitCost: rItem.unitCost,
          referenceType: 'RETURN',
          referenceId: sale.id,
          createdBy: userId,
          remarks: `Damaged return stock-in against ${sale.invoice_no}`,
        });

        // Step b: DAMAGE stock-out so ledger balances
        await this.stockService.applyMovement(tx, {
          businessId,
          branchId: currentBranchId,
          variantId: rItem.variantId,
          movementType: 'DAMAGE',
          quantity: rItem.quantity,
          unitCost: rItem.unitCost,
          referenceType: 'RETURN',
          referenceId: sale.id,
          createdBy: userId,
          remarks: `Damaged return written off against ${sale.invoice_no}`,
        });

        // Step c: Create DamagedStock record with status WRITTEN_OFF
        const damageNo = await this.sequenceService.getNextNumber(
          tx,
          businessId,
          currentBranchId,
          'DAMAGE',
          'DMG-',
        );

        await tx.damagedStock.create({
          data: {
            business_id: businessId,
            branch_id: currentBranchId,
            damage_no: damageNo,
            product_variant_id: rItem.variantId,
            quantity: rItem.quantity,
            unit_cost: rItem.unitCost,
            total_loss: rItem.quantity.times(rItem.unitCost),
            reason: dto.reason || 'Returned item damaged and written off',
            status: 'WRITTEN_OFF',
            reported_by: userId,
            approved_by: userId,
          },
        });
      }

      // Tracked Units Update: Set status to IN_STOCK or DAMAGED, move branch to accepting branch
      if (rItem.trackedUnitBarcodes && rItem.trackedUnitBarcodes.length > 0) {
        await tx.productUnit.updateMany({
          where: {
            business_id: businessId,
            barcode_value: { in: rItem.trackedUnitBarcodes },
          },
          data: {
            status: rItem.condition === 'DAMAGED' ? 'DAMAGED' : 'IN_STOCK',
            branch_id: currentBranchId,
            // We retain sold_sale_id and sold_at on ProductUnit for historical auditing
          },
        });
      }

      // Update SaleItem.returned_qty
      await tx.saleItem.update({
        where: { id: rItem.saleItemId },
        data: {
          returned_qty: {
            increment: rItem.quantity,
          },
        },
      });
    }

    // 11. Loyalty Points Reversal (Proportional: 1 point per 100 Taka returned)
    if (sale.customer_id) {
      const pointsToDeduct = Math.floor(Number(totalRefundAmount) / 100);

      if (pointsToDeduct > 0) {
        const customer = await tx.customer.findUnique({
          where: { id: sale.customer_id },
          select: { loyalty_points: true },
        });

        const currentPoints = customer?.loyalty_points || 0;
        const actualDeduction = Math.min(currentPoints, pointsToDeduct);

        if (actualDeduction > 0) {
          await tx.customer.update({
            where: { id: sale.customer_id },
            data: {
              loyalty_points: {
                decrement: actualDeduction,
              },
            },
          });
        }
      }
    }

    // 12. Determine new Sale status:
    // If every item is fully returned, status = RETURNED.
    // For partial returns, keep original status (or COMPLETED if dues cleared).
    const allSaleItems = await tx.saleItem.findMany({
      where: { sale_id: sale.id },
    });

    const isFullyReturned = allSaleItems.every((si) => {
      const addedQty =
        returnItemsToCreate.find((ri) => ri.saleItemId === si.id)?.quantity ||
        new Prisma.Decimal(0);
      return new Prisma.Decimal(si.returned_qty)
        .plus(addedQty)
        .greaterThanOrEqualTo(si.quantity);
    });

    const newSaleStatus = isFullyReturned
      ? 'RETURNED'
      : sale.status;

    await tx.sale.update({
      where: { id: sale.id },
      data: {
        due_amount: newSaleDue,
        paid_amount: newSalePaid,
        status: newSaleStatus,
      },
    });

    // 13. Generate return_no atomically via InvoiceSequence (SALES_RETURN)
    const returnNo = await this.sequenceService.getNextNumber(
      tx,
      businessId,
      currentBranchId,
      'SALES_RETURN',
      'SR-',
    );

    // 14. Create SalesReturn & SalesReturnItem rows
    const salesReturn = await tx.salesReturn.create({
      data: {
        business_id: businessId,
        branch_id: currentBranchId,
        sale_id: sale.id,
        customer_id: sale.customer_id,
        return_no: returnNo,
        idempotency_key: dto.idempotencyKey,
        total_refund_amount: totalRefundAmount,
        refund_method: dto.refundMethod,
        status: 'COMPLETED',
        reason: dto.reason || null,
        register_session_id: activeSessionId,
        payment_account_id: null,
        created_by: userId,
        items: {
          create: returnItemsToCreate.map((ri) => ({
            sale_item_id: ri.saleItemId,
            product_variant_id: ri.variantId,
            quantity: ri.quantity,
            refund_price: ri.refundPrice,
            unit_cost: ri.unitCost,
            total_refund: ri.totalRefund,
            condition: ri.condition,
          })),
        },
      },
      include: {
        items: {
          include: {
            variant: {
              select: { id: true, sku: true, product_id: true },
            },
          },
        },
      },
    });

    // 15. Audit Log
    await tx.auditLog.create({
      data: {
        business_id: businessId,
        branch_id: currentBranchId,
        user_id: userId,
        action: 'CREATE',
        entity_table: 'sales_returns',
        entity_id: salesReturn.id,
        new_values: {
          return_no: returnNo,
          sale_id: sale.id,
          total_refund_amount: totalRefundAmount.toString(),
          due_reduction: dueReduction.toString(),
          payout_amount: payoutAmount.toString(),
          refund_method: dto.refundMethod,
          is_cross_branch: isCrossBranch,
          accepting_branch_id: currentBranchId,
        },
      },
    });

    return {
      ...salesReturn,
      crossBranchAccepted: isCrossBranch,
      acceptingBranchId: currentBranchId,
      dueReduction: dueReduction.toString(),
      payoutAmount: payoutAmount.toString(),
    };
  }

  /**
   * List returns (branch-scoped, admin sees all branches).
   */
  async getReturnList(
    businessId: string,
    branchId: string,
    query: SalesReturnQueryDto,
    isAllBranchAdmin: boolean = false,
  ) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.SalesReturnWhereInput = {
      business_id: businessId,
      ...(isAllBranchAdmin ? {} : { branch_id: branchId }),
      ...(query.saleId ? { sale_id: query.saleId } : {}),
      ...(query.customerId ? { customer_id: query.customerId } : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.salesReturn.count({ where }),
      this.prisma.salesReturn.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          items: true,
          customer: { select: { id: true, name: true, phone: true } },
          sale: { select: { id: true, invoice_no: true, total_amount: true } },
        },
      }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Detail of a single SalesReturn with branch scoping.
   */
  async getReturnDetail(
    businessId: string,
    branchId: string,
    returnId: string,
    isAllBranchAdmin: boolean = false,
  ) {
    const returnRecord = await this.prisma.salesReturn.findFirst({
      where: {
        id: returnId,
        business_id: businessId,
        ...(isAllBranchAdmin ? {} : { branch_id: branchId }),
      },
      include: {
        items: {
          include: {
            variant: true,
          },
        },
        customer: true,
        sale: {
          include: {
            branch: { select: { id: true, name: true, code: true } },
          },
        },
      },
    });

    if (!returnRecord) {
      throw new NotFoundException(
        `Sales return with ID "${returnId}" not found in this branch context.`,
      );
    }

    return returnRecord;
  }

  /**
   * Printable Return Slip payload.
   */
  async getReturnSlip(
    businessId: string,
    branchId: string,
    returnId: string,
    isAllBranchAdmin: boolean = false,
  ) {
    const record = await this.getReturnDetail(
      businessId,
      branchId,
      returnId,
      isAllBranchAdmin,
    );

    const branch = await this.prisma.branch.findUnique({
      where: { id: record.branch_id },
      select: { name: true, address: true, phone: true },
    });

    return {
      slipTitle: 'SALES RETURN RECEIPT',
      returnNo: record.return_no,
      date: record.created_at,
      originalInvoiceNo: record.sale.invoice_no,
      customer: record.customer
        ? { name: record.customer.name, phone: record.customer.phone }
        : null,
      acceptingBranch: branch,
      items: record.items.map((i) => ({
        sku: i.variant.sku,
        quantity: i.quantity.toString(),
        condition: i.condition,
        refundPrice: i.refund_price.toString(),
        totalRefund: i.total_refund.toString(),
      })),
      totalRefundAmount: record.total_refund_amount.toString(),
      refundMethod: record.refund_method,
      reason: record.reason,
    };
  }
}
