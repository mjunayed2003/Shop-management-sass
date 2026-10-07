import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { StockService } from '../../inventory/services/stock.service.js';
import { StockTransferService } from '../../inventory/services/stock-transfer.service.js';
import { SequenceService } from '../../inventory/services/sequence.service.js';
import { PricingService, CalculatedCart } from './pricing.service.js';
import { RegisterSessionService } from './register-session.service.js';
import { SmsStubService } from './sms-stub.service.js';
import { CreateSaleDto } from '../dto/create-sale.dto.js';
import { VoidSaleDto } from '../dto/void-sale.dto.js';
import {
  SaleQueryDto,
  DailySalesSummaryQueryDto,
  SalesReportQueryDto,
} from '../dto/sale-query.dto.js';
import {
  Prisma,
  SaleStatus,
  SaleType,
  PaymentMethod,
} from '../../../generated/prisma/client.js';

export interface CreateSaleOptions {
  tx?: Prisma.TransactionClient;
  exchangeCreditAmount?: Prisma.Decimal;
  isOffline?: boolean;
  syncedAt?: Date;
  saleDate?: Date;
  allowNegativeStock?: boolean;
  reservedInvoiceNo?: string;
}

@Injectable()
export class SaleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
    private readonly stockTransferService: StockTransferService,
    private readonly sequenceService: SequenceService,
    private readonly pricingService: PricingService,
    private readonly registerSessionService: RegisterSessionService,
    private readonly smsStubService: SmsStubService,
  ) {}

  /**
   * Main POS sale creation endpoint executing in ONE atomic transaction.
   * Handles idempotency, server recalculation, cross-branch auto-transfer,
   * stock deduction & WAC cost capture, tracked units, payments, customer credit,
   * loyalty points, SMS queue, and audit logs.
   */
  async createSale(
    businessId: string,
    currentBranchId: string,
    userId: string,
    dto: CreateSaleDto,
    userRole?: { code?: string; name?: string; permissions?: string[] },
    options?: CreateSaleOptions,
  ) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Sale cart must contain at least one item.');
    }

    if (options?.tx) {
      return this.executeSaleTransaction(
        options.tx,
        businessId,
        currentBranchId,
        userId,
        dto,
        userRole,
        options,
      );
    }

    // 1. Pessimistic / single atomic transaction
    return this.prisma.$transaction(
      async (tx) => {
        return this.executeSaleTransaction(
          tx,
          businessId,
          currentBranchId,
          userId,
          dto,
          userRole,
          options,
        );
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  async executeSaleTransaction(
    tx: Prisma.TransactionClient,
    businessId: string,
    currentBranchId: string,
    userId: string,
    dto: CreateSaleDto,
    userRole?: { code?: string; name?: string; permissions?: string[] },
    options?: CreateSaleOptions,
  ) {
    const negativeVariants: Array<{ variantId: string; sku: string; balance: number }> = [];
    let exceededCreditLimit = false;
    const payloadHash = this.computePayloadHash(dto);
      // ----------------------------------------------------
      // A. IDEMPOTENCY CHECK
      // ----------------------------------------------------
      const existingIdem = await tx.idempotencyKey.findUnique({
        where: {
          business_id_key: {
            business_id: businessId,
            key: dto.idempotencyKey,
          },
        },
      });

      if (existingIdem) {
        if (existingIdem.request_hash === payloadHash) {
          if (existingIdem.response_payload) {
            return existingIdem.response_payload;
          }
          // Fetch existing sale if cached body was not stored
          const existingSale = await tx.sale.findFirst({
            where: {
              business_id: businessId,
              idempotency_key: dto.idempotencyKey,
            },
            include: this.getSaleIncludeConfig(),
          });
          if (existingSale) {
            return this.formatSaleInvoiceResponse(existingSale);
          }
        } else {
          throw new ConflictException(
            'Idempotency key already used with a different request payload.',
          );
        }
      }

      // Also double-check Sale table direct constraint
      const existingDirectSale = await tx.sale.findFirst({
        where: {
          business_id: businessId,
          idempotency_key: dto.idempotencyKey,
        },
        include: this.getSaleIncludeConfig(),
      });
      if (existingDirectSale) {
        return this.formatSaleInvoiceResponse(existingDirectSale);
      }

      // ----------------------------------------------------
      // B. REGISTER SESSION VALIDATION
      // ----------------------------------------------------
      const activeSession = await this.registerSessionService.validateActiveSession(
        businessId,
        currentBranchId,
        userId,
        dto.registerSessionId,
      );

      // ----------------------------------------------------
      // C. SERVER-SIDE CART CALCULATION (Client totals ignored)
      // ----------------------------------------------------
      const calculatedCart: CalculatedCart = await this.pricingService.calculateCart(
        businessId,
        currentBranchId,
        {
          items: dto.items,
          saleType: dto.saleType,
          customerId: dto.customerId,
          couponCode: dto.couponCode,
        },
        userRole,
        tx,
      );

      // ----------------------------------------------------
      // D. CROSS-BRANCH AUTO-TRANSFER (Phase 4 Section E)
      // ----------------------------------------------------
      const crossBranchItems = calculatedCart.items.filter(
        (i) => i.sourceBranchId && i.sourceBranchId !== currentBranchId,
      );
      const autoTransfersInfo: Array<{ transferNo: string; fromBranchId: string; itemsCount: number }> = [];

      if (crossBranchItems.length > 0) {
        // Must possess sale.cross_branch permission
        const hasCrossBranchPerm =
          userRole?.permissions?.includes('sale.cross_branch') ||
          userRole?.permissions?.includes('sales:cross_branch') ||
          userRole?.permissions?.includes('sale:*') ||
          userRole?.permissions?.includes('*') ||
          userRole?.code === 'OWNER' ||
          userRole?.code === 'SUPER_ADMIN';

        if (!hasCrossBranchPerm) {
          throw new ForbiddenException(
            'Cross-branch sales require the "sale.cross_branch" permission.',
          );
        }

        if (dto.isOffline) {
          throw new BadRequestException(
            'Cross-branch auto-transfer is not allowed for offline-originated sales.',
          );
        }

        // Group by source branch
        const branchGroups = new Map<string, typeof crossBranchItems>();
        for (const cItem of crossBranchItems) {
          const group = branchGroups.get(cItem.sourceBranchId!) || [];
          group.push(cItem);
          branchGroups.set(cItem.sourceBranchId!, group);
        }

        for (const [sourceBranchId, itemsInGroup] of branchGroups.entries()) {
          // Validate source branch belongs to business and is active
          const sourceBranch = await tx.branch.findFirst({
            where: { id: sourceBranchId, business_id: businessId, is_active: true },
          });
          if (!sourceBranch) {
            throw new BadRequestException(
              `Source branch "${sourceBranchId}" does not exist or is inactive in your business.`,
            );
          }

          const transferIdemKey = `${dto.idempotencyKey}:${sourceBranchId}`;
          const transferResult = await this.stockTransferService.createInstantTransfer(
            tx,
            {
              businessId,
              fromBranch: sourceBranchId,
              toBranch: currentBranchId,
              items: itemsInGroup.map((it) => ({
                variantId: it.variantId,
                quantity: it.quantity.toNumber(),
              })),
              idempotencyKey: transferIdemKey,
              notes: `Auto-transfer for sale ${dto.idempotencyKey}`,
              createdBy: userId,
            },
          );

          autoTransfersInfo.push({
            transferNo: transferResult.transfer_no,
            fromBranchId: sourceBranchId,
            itemsCount: itemsInGroup.length,
          });
        }
      }

      // Validate branch visibility for local items
      for (const item of calculatedCart.items) {
        if (!item.sourceBranchId || item.sourceBranchId === currentBranchId) {
          const productBranch = await tx.productBranch.findFirst({
            where: {
              business_id: businessId,
              branch_id: currentBranchId,
              product_id: item.productId,
              is_active: true,
            },
          });
          if (!productBranch) {
            throw new BadRequestException(
              `Product "${item.productName}" is not active or assigned to this branch.`,
            );
          }
        }
      }

      // ----------------------------------------------------
      // E. GENERATE INVOICE NUMBER
      // ----------------------------------------------------
      const invoiceNo =
        options?.reservedInvoiceNo ||
        (await this.sequenceService.getNextNumber(
          tx,
          businessId,
          currentBranchId,
          'SALE_INVOICE',
        ));

      // ----------------------------------------------------
      // F. PAYMENTS & OVERPAYMENT RULES
      // ----------------------------------------------------
      const totalAmount = calculatedCart.totalAmount;
      const creditApplied = options?.exchangeCreditAmount
        ? Prisma.Decimal.min(options.exchangeCreditAmount, totalAmount)
        : new Prisma.Decimal(0);
      const remainingToPay = totalAmount.minus(creditApplied);

      let totalNonCashPaid = new Prisma.Decimal(0);
      let totalCashTendered = new Prisma.Decimal(0);

      const processedPayments: Array<{
        paymentMethod: PaymentMethod;
        amount: Prisma.Decimal;
        transactionNo?: string;
        idempotencyKey: string;
      }> = [];

      for (let i = 0; i < (dto.payments || []).length; i++) {
        const p = dto.payments[i];
        const pAmount = new Prisma.Decimal(p.amount);
        if (pAmount.lessThan(0)) {
          throw new BadRequestException('Payment amount cannot be negative.');
        }

        if (p.paymentMethod === PaymentMethod.CASH) {
          totalCashTendered = totalCashTendered.plus(pAmount);
        } else {
          totalNonCashPaid = totalNonCashPaid.plus(pAmount);
          processedPayments.push({
            paymentMethod: p.paymentMethod,
            amount: pAmount,
            transactionNo: p.transactionNo,
            idempotencyKey: p.idempotencyKey || `${dto.idempotencyKey}:pay:${i}`,
          });
        }
      }

      // Overpayment rule 1: Non-cash payments cannot exceed remaining amount to pay
      if (totalNonCashPaid.greaterThan(remainingToPay)) {
        throw new BadRequestException(
          `Non-cash payments (BDT ${totalNonCashPaid.toString()}) cannot exceed the amount to pay (BDT ${remainingToPay.toString()}).`,
        );
      }

      // Overpayment rule 2: Cash excess is change_amount (not stored as payment)
      const remainingBeforeCash = remainingToPay.minus(totalNonCashPaid);
      let netCashToRecord = new Prisma.Decimal(0);
      let changeAmount = new Prisma.Decimal(0);

      if (totalCashTendered.greaterThan(0)) {
        if (totalCashTendered.greaterThan(remainingBeforeCash)) {
          changeAmount = totalCashTendered.minus(remainingBeforeCash);
          netCashToRecord = remainingBeforeCash;
        } else {
          netCashToRecord = totalCashTendered;
          changeAmount = new Prisma.Decimal(0);
        }

        if (netCashToRecord.greaterThan(0)) {
          processedPayments.push({
            paymentMethod: PaymentMethod.CASH,
            amount: netCashToRecord,
            idempotencyKey: `${dto.idempotencyKey}:pay:cash`,
          });
        }
      }

      const totalRecordedPaid = creditApplied.plus(totalNonCashPaid).plus(netCashToRecord);
      const dueAmount = totalAmount.minus(totalRecordedPaid).greaterThan(0)
        ? totalAmount.minus(totalRecordedPaid)
        : new Prisma.Decimal(0);

      let status: SaleStatus = SaleStatus.COMPLETED;
      if (dueAmount.greaterThan(0)) {
        status = totalRecordedPaid.greaterThan(0)
          ? SaleStatus.PARTIALLY_PAID
          : SaleStatus.DUE;
      }

      // ----------------------------------------------------
      // G. CUSTOMER CREDIT & WHOLESALE VALIDATION
      // ----------------------------------------------------
      if (dueAmount.greaterThan(0) && !dto.customerId) {
        throw new BadRequestException(
          'Customer is required when a sale has an outstanding due amount (walk-in credit not permitted).',
        );
      }

      if (dto.saleType === SaleType.WHOLESALE && !dto.customerId) {
        throw new BadRequestException('A registered customer is required for wholesale sales.');
      }

      let customer: any = null;
      let loyaltyPointsEarned = 0;

      if (dto.customerId) {
        customer = await tx.customer.findFirst({
          where: { id: dto.customerId, business_id: businessId, deleted_at: null },
        });

        if (!customer) {
          throw new NotFoundException(`Customer "${dto.customerId}" not found.`);
        }

        if (dueAmount.greaterThan(0)) {
          const creditLimit = new Prisma.Decimal(customer.credit_limit);
          const newTotalDue = new Prisma.Decimal(customer.current_due).plus(dueAmount);

          if (creditLimit.greaterThan(0) && newTotalDue.greaterThan(creditLimit)) {
            if (options?.isOffline) {
              exceededCreditLimit = true;
            } else {
              throw new BadRequestException(
                `Credit limit exceeded for customer "${customer.name}". Limit: BDT ${creditLimit.toString()}, Current Due + New: BDT ${newTotalDue.toString()}`,
              );
            }
          }

          // Atomically increment customer current_due
          await tx.customer.update({
            where: { id: customer.id },
            data: { current_due: { increment: dueAmount } },
          });
        }

        // Loyalty points: 1 point per 100 Taka
        loyaltyPointsEarned = Math.floor(totalAmount.toNumber() / 100);
        if (loyaltyPointsEarned > 0) {
          await tx.customer.update({
            where: { id: customer.id },
            data: { loyalty_points: { increment: loyaltyPointsEarned } },
          });
        }
      }

      // ----------------------------------------------------
      // H. COUPON USAGE ATOMIC INCREMENT
      // ----------------------------------------------------
      if (calculatedCart.couponId) {
        const updatedCoupon = await tx.coupon.update({
          where: { id: calculatedCart.couponId },
          data: { usage_count: { increment: 1 } },
        });

        if (
          updatedCoupon.usage_limit !== null &&
          updatedCoupon.usage_count > updatedCoupon.usage_limit
        ) {
          throw new BadRequestException(
            'Coupon usage limit has been exceeded by a concurrent transaction.',
          );
        }
      }

      // ----------------------------------------------------
      // I. STOCK DEDUCTION & WAC COST CAPTURE
      // ----------------------------------------------------
      let saleTotalCost = new Prisma.Decimal(0);
      const saleItemsToCreate: Array<{
        product_variant_id: string;
        product_unit_id?: string | null;
        quantity: Prisma.Decimal;
        unit_price: Prisma.Decimal;
        unit_cost: Prisma.Decimal;
        discount_amount: Prisma.Decimal;
        tax_amount: Prisma.Decimal;
        total_amount: Prisma.Decimal;
        total_cost: Prisma.Decimal;
      }> = [];

      // Pre-create Sale shell to have sale.id for stock movements and unit links
      const sale = await tx.sale.create({
        data: {
          business_id: businessId,
          branch_id: currentBranchId,
          customer_id: customer?.id || null,
          cash_register_id: activeSession.cash_register_id,
          register_session_id: activeSession.id,
          invoice_no: invoiceNo,
          idempotency_key: dto.idempotencyKey,
          sale_type: dto.saleType || SaleType.RETAIL,
          status,
          subtotal: calculatedCart.subtotal,
          discount_amount: calculatedCart.totalDiscount,
          coupon_id: calculatedCart.couponId || null,
          tax_amount: calculatedCart.taxAmount,
          round_off: calculatedCart.roundOff,
          total_amount: totalAmount,
          paid_amount: totalRecordedPaid,
          due_amount: dueAmount,
          change_amount: changeAmount,
          total_cost: new Prisma.Decimal(0), // Will update after item loop
          sale_date: options?.saleDate || new Date(),
          is_offline: options?.isOffline ?? (dto.isOffline || false),
          synced_at: options?.syncedAt ?? (options?.isOffline ? new Date() : null),
          created_by: userId,
        },
      });

      for (const cItem of calculatedCart.items) {
        // Check tracked units
        let unitIdToLink: string | null = null;
        if (cItem.trackIndividually) {
          const barcode = cItem.productUnitBarcode;
          if (!barcode) {
            throw new BadRequestException(
              `Variant "${cItem.variantSku}" requires a scanned product unit barcode.`,
            );
          }

          const unit = await tx.productUnit.findFirst({
            where: {
              business_id: businessId,
              barcode_value: barcode,
            },
          });

          if (!unit) {
            throw new NotFoundException(`Product unit barcode "${barcode}" not found.`);
          }
          if (unit.branch_id !== currentBranchId) {
            throw new BadRequestException(
              `Product unit "${barcode}" belongs to another branch and cannot be sold directly.`,
            );
          }
          if (unit.status !== 'IN_STOCK') {
            throw new BadRequestException(
              `Product unit "${barcode}" is already ${unit.status} and cannot be sold.`,
            );
          }

          // Mark unit SOLD
          await tx.productUnit.update({
            where: { id: unit.id },
            data: {
              status: 'SOLD',
              sold_sale_id: sale.id,
              sold_at: new Date(),
            },
          });

          unitIdToLink = unit.id;
        }

        // Stock deduction via StockService
        const movementResult = await this.stockService.applyMovement(tx, {
          businessId,
          branchId: currentBranchId,
          variantId: cItem.variantId,
          movementType: 'SALE',
          quantity: cItem.quantity,
          referenceType: 'SALE',
          referenceId: sale.id,
          createdBy: userId,
          remarks: `POS Sale ${invoiceNo}`,
          allowNegativeStock: options?.allowNegativeStock || false,
        });

        if (movementResult.balance && new Prisma.Decimal(movementResult.balance.quantity).lessThan(0)) {
          negativeVariants.push({
            variantId: cItem.variantId,
            sku: cItem.variantSku,
            balance: Number(movementResult.balance.quantity),
          });
        }

        const unitCost = movementResult.newWac;
        const lineTotalCost = unitCost
          .times(cItem.quantity)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        saleTotalCost = saleTotalCost.plus(lineTotalCost);

        saleItemsToCreate.push({
          product_variant_id: cItem.variantId,
          product_unit_id: unitIdToLink,
          quantity: cItem.quantity,
          unit_price: cItem.unitPrice,
          unit_cost: unitCost,
          discount_amount: cItem.discountAmount,
          tax_amount: cItem.taxAmount,
          total_amount: cItem.totalAmount,
          total_cost: lineTotalCost,
        });
      }

      // Create SaleItems
      for (const itemData of saleItemsToCreate) {
        await tx.saleItem.create({
          data: {
            sale_id: sale.id,
            ...itemData,
          },
        });
      }

      // Update Sale total_cost
      await tx.sale.update({
        where: { id: sale.id },
        data: { total_cost: saleTotalCost },
      });

      // ----------------------------------------------------
      // J. CREATE SALE PAYMENTS
      // ----------------------------------------------------
      for (const paymentData of processedPayments) {
        await tx.salePayment.create({
          data: {
            business_id: businessId,
            branch_id: currentBranchId,
            sale_id: sale.id,
            register_session_id: activeSession.id,
            payment_method: paymentData.paymentMethod,
            amount: paymentData.amount,
            transaction_no: paymentData.transactionNo || null,
            idempotency_key: paymentData.idempotencyKey,
            created_by: userId,
          },
        });
      }

      // ----------------------------------------------------
      // K. SMS QUEUE
      // ----------------------------------------------------
      if (customer && customer.phone) {
        await this.smsStubService.sendSms(tx, {
          businessId,
          branchId: currentBranchId,
          recipientPhone: customer.phone,
          message: `Thank you for shopping with us! Invoice: ${invoiceNo}, Paid: ${totalRecordedPaid.toString()} BDT, Due: ${dueAmount.toString()} BDT.`,
          purpose: 'SALE_INVOICE',
        });
      }

      // ----------------------------------------------------
      // L. AUDIT LOGS
      // ----------------------------------------------------
      await tx.auditLog.create({
        data: {
          business_id: businessId,
          branch_id: currentBranchId,
          user_id: userId,
          action: 'CREATE',
          entity_table: 'sales',
          entity_id: sale.id,
          new_values: {
            invoiceNo,
            totalAmount: totalAmount.toNumber(),
            paidAmount: totalRecordedPaid.toNumber(),
            dueAmount: dueAmount.toNumber(),
            itemsCount: calculatedCart.items.length,
          },
        },
      });

      if (crossBranchItems.length > 0) {
        await tx.auditLog.create({
          data: {
            business_id: businessId,
            branch_id: currentBranchId,
            user_id: userId,
            action: 'UPDATE',
            entity_table: 'sales',
            entity_id: sale.id,
            new_values: {
              type: 'CROSS_BRANCH_AUTO_TRANSFER',
              transfers: autoTransfersInfo,
            },
          },
        });
      }

      // ----------------------------------------------------
      // M. CACHE IDEMPOTENCY KEY RESULT
      // ----------------------------------------------------
      const fullSale = await tx.sale.findUniqueOrThrow({
        where: { id: sale.id },
        include: this.getSaleIncludeConfig(),
      });

      const responsePayload = this.formatSaleInvoiceResponse(
        fullSale,
        autoTransfersInfo,
      );

      (responsePayload as any).negativeVariants = negativeVariants;
      (responsePayload as any).exceededCreditLimit = exceededCreditLimit;

      await tx.idempotencyKey.upsert({
        where: {
          business_id_key: {
            business_id: businessId,
            key: dto.idempotencyKey,
          },
        },
        create: {
          business_id: businessId,
          key: dto.idempotencyKey,
          resource_type: 'SALE',
          resource_id: sale.id,
          request_hash: payloadHash,
          response_payload: responsePayload as any,
          status: 'COMPLETED',
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        update: {
          status: 'COMPLETED',
          response_payload: responsePayload as any,
          resource_id: sale.id,
        },
      });

      return responsePayload;
  }

  /**
   * Voids an existing sale in ONE atomic transaction.
   * Reverses stock movements, restores tracked product units,
   * decrements customer due balance and loyalty points, decrements coupon usage,
   * creates compensating negative payments, and records audit logs.
   * Auto-transferred stock stays in the branch.
   */
  async voidSale(
    businessId: string,
    currentBranchId: string,
    userId: string,
    saleId: string,
    dto: VoidSaleDto,
  ) {
    if (!dto.reason || !dto.reason.trim()) {
      throw new BadRequestException('A reason is required to void a sale.');
    }

    return this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({
        where: { id: saleId, business_id: businessId },
        include: {
          items: true,
          payments: true,
          returns: true,
          original_exchange: true,
          customer: true,
        },
      });

      if (!sale) {
        throw new NotFoundException(`Sale with ID "${saleId}" not found.`);
      }

      if (sale.branch_id !== currentBranchId) {
        throw new ForbiddenException('A sale can only be voided in the branch where it was created.');
      }

      if (sale.status === SaleStatus.VOIDED) {
        throw new BadRequestException(`Sale "${sale.invoice_no}" is already voided.`);
      }

      if (sale.returns.length > 0 || sale.original_exchange.length > 0) {
        throw new BadRequestException(
          'Cannot void a sale that has associated sales returns or exchanges.',
        );
      }

      // Check void window (same day or within 24 hours)
      const saleAgeHours =
        (Date.now() - new Date(sale.sale_date).getTime()) / (1000 * 60 * 60);
      if (saleAgeHours > 48) {
        throw new BadRequestException(
          'Void window expired. Sales older than 48 hours cannot be voided.',
        );
      }

      // 1. Reverse stock movements
      for (const item of sale.items) {
        await this.stockService.applyMovement(tx, {
          businessId,
          branchId: currentBranchId,
          variantId: item.product_variant_id,
          movementType: 'SALE_RETURN',
          unitCost: item.unit_cost,
          quantity: item.quantity,
          referenceType: 'RETURN',
          referenceId: sale.id,
          createdBy: userId,
          remarks: `Void invoice ${sale.invoice_no}: ${dto.reason.trim()}`,
        });
      }

      // 2. Restore tracked ProductUnits to IN_STOCK
      await tx.productUnit.updateMany({
        where: { sold_sale_id: sale.id },
        data: {
          status: 'IN_STOCK',
          sold_sale_id: null,
          sold_at: null,
        },
      });

      // 3. Reverse Customer Due & Loyalty Points
      if (sale.customer_id) {
        const dueAmount = new Prisma.Decimal(sale.due_amount);
        if (dueAmount.greaterThan(0)) {
          await tx.customer.update({
            where: { id: sale.customer_id },
            data: { current_due: { decrement: dueAmount } },
          });
        }

        const loyaltyPointsToRevoke = Math.floor(
          new Prisma.Decimal(sale.total_amount).toNumber() / 100,
        );
        if (loyaltyPointsToRevoke > 0) {
          await tx.customer.update({
            where: { id: sale.customer_id },
            data: { loyalty_points: { decrement: loyaltyPointsToRevoke } },
          });
        }
      }

      // 4. Reverse Coupon usage count
      if (sale.coupon_id) {
        await tx.coupon.update({
          where: { id: sale.coupon_id },
          data: { usage_count: { decrement: 1 } },
        });
      }

      // 5. Create compensating negative SalePayments (ledger audit approach)
      for (const p of sale.payments) {
        if (new Prisma.Decimal(p.amount).greaterThan(0)) {
          await tx.salePayment.create({
            data: {
              business_id: businessId,
              branch_id: currentBranchId,
              sale_id: sale.id,
              register_session_id: p.register_session_id,
              payment_method: p.payment_method,
              amount: new Prisma.Decimal(p.amount).negated(),
              transaction_no: `VOID-REVERSAL-${p.id}`,
              idempotency_key: `${p.idempotency_key}:void`,
              created_by: userId,
            },
          });
        }
      }

      // 6. Update Sale status
      const updatedSale = await tx.sale.update({
        where: { id: sale.id },
        data: {
          status: SaleStatus.VOIDED,
          voided_at: new Date(),
          void_reason: dto.reason.trim(),
          updated_by: userId,
        },
        include: this.getSaleIncludeConfig(),
      });

      // 7. Record Audit Log
      await tx.auditLog.create({
        data: {
          business_id: businessId,
          branch_id: currentBranchId,
          user_id: userId,
          action: 'VOID',
          entity_table: 'sales',
          entity_id: sale.id,
          new_values: {
            reason: dto.reason.trim(),
            reversedPaid: Number(sale.paid_amount),
            reversedDue: Number(sale.due_amount),
          },
        },
      });

      return {
        message: `Sale "${sale.invoice_no}" has been voided successfully.`,
        note: 'Any cross-branch auto-transferred stock remains in the current branch.',
        sale: this.formatSaleInvoiceResponse(updatedSale),
      };
    });
  }

  /**
   * List sales with date, cashier, customer, session, invoice, and status filters.
   * Enforces branch boundary unless caller is an all-branch admin.
   */
  async getSaleList(
    businessId: string,
    currentBranchId: string,
    query: SaleQueryDto,
    isAllBranchAdmin: boolean = false,
  ) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Number(query.limit || 20));
    const skip = (page - 1) * limit;

    const targetBranchId = isAllBranchAdmin && query.branchId ? query.branchId : currentBranchId;

    const where: Prisma.SaleWhereInput = {
      business_id: businessId,
      ...(isAllBranchAdmin && !query.branchId ? {} : { branch_id: targetBranchId }),
      ...(query.status && { status: query.status }),
      ...(query.saleType && { sale_type: query.saleType }),
      ...(query.customerId && { customer_id: query.customerId }),
      ...(query.cashierId && { created_by: query.cashierId }),
      ...(query.registerSessionId && { register_session_id: query.registerSessionId }),
      ...(query.invoiceNo && { invoice_no: { contains: query.invoiceNo.trim(), mode: 'insensitive' } }),
      ...(query.startDate || query.endDate
        ? {
            sale_date: {
              ...(query.startDate && { gte: new Date(query.startDate) }),
              ...(query.endDate && { lte: new Date(query.endDate) }),
            },
          }
        : {}),
    };

    const [total, sales] = await Promise.all([
      this.prisma.sale.count({ where }),
      this.prisma.sale.findMany({
        where,
        skip,
        take: limit,
        orderBy: { sale_date: 'desc' },
        include: this.getSaleIncludeConfig(),
      }),
    ]);

    return {
      data: sales.map((s) => this.formatSaleInvoiceResponse(s)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Retrieves single sale by ID or invoice number, strictly enforcing branch access.
   */
  async getSaleDetail(
    businessId: string,
    currentBranchId: string,
    identifier: string,
    isAllBranchAdmin: boolean = false,
  ) {
    const sale = await this.prisma.sale.findFirst({
      where: {
        business_id: businessId,
        OR: [{ id: identifier }, { invoice_no: identifier }],
      },
      include: this.getSaleIncludeConfig(),
    });

    if (!sale) {
      throw new NotFoundException(`Sale "${identifier}" not found.`);
    }

    if (!isAllBranchAdmin && sale.branch_id !== currentBranchId) {
      throw new ForbiddenException(
        'You are not authorized to view sales originating from another branch.',
      );
    }

    return this.formatSaleInvoiceResponse(sale);
  }

  /**
   * Daily sales summary report grouped by payment methods.
   */
  async getDailySalesSummary(
    businessId: string,
    currentBranchId: string,
    query: DailySalesSummaryQueryDto,
    isAllBranchAdmin: boolean = false,
  ) {
    const targetBranchId = isAllBranchAdmin && query.branchId ? query.branchId : currentBranchId;

    const targetDate = query.date ? new Date(query.date) : new Date();
    const startOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0);
    const endOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59, 999);

    const where: Prisma.SaleWhereInput = {
      business_id: businessId,
      ...(isAllBranchAdmin && !query.branchId ? {} : { branch_id: targetBranchId }),
      sale_date: { gte: startOfDay, lte: endOfDay },
      status: { not: SaleStatus.VOIDED },
    };

    const sales = await this.prisma.sale.findMany({
      where,
      include: { payments: true },
    });

    let totalGross = 0;
    let totalDiscount = 0;
    let totalNet = 0;
    let totalPaid = 0;
    let totalDue = 0;
    let totalCost = 0;

    const paymentMethodMap: Record<string, number> = {};

    for (const s of sales) {
      totalGross += Number(s.subtotal);
      totalDiscount += Number(s.discount_amount);
      totalNet += Number(s.total_amount);
      totalPaid += Number(s.paid_amount);
      totalDue += Number(s.due_amount);
      totalCost += Number(s.total_cost);

      for (const p of s.payments) {
        const pMethod = p.payment_method;
        paymentMethodMap[pMethod] = (paymentMethodMap[pMethod] || 0) + Number(p.amount);
      }
    }

    const grossProfit = Math.round((totalNet - totalCost) * 100) / 100;

    return {
      date: startOfDay.toISOString().split('T')[0],
      branchId: isAllBranchAdmin && !query.branchId ? 'ALL' : targetBranchId,
      totalSalesCount: sales.length,
      grossSales: Math.round(totalGross * 100) / 100,
      totalDiscounts: Math.round(totalDiscount * 100) / 100,
      netSales: Math.round(totalNet * 100) / 100,
      totalPaid: Math.round(totalPaid * 100) / 100,
      totalDue: Math.round(totalDue * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
      grossProfit,
      paymentsByMethod: Object.entries(paymentMethodMap).map(([method, amount]) => ({
        method,
        amount: Math.round(amount * 100) / 100,
      })),
    };
  }

  /**
   * Sales grouped by product, brand, or category.
   */
  async getSalesReportByGroup(
    businessId: string,
    currentBranchId: string,
    query: SalesReportQueryDto,
    groupBy: 'product' | 'brand' | 'category' = 'product',
    isAllBranchAdmin: boolean = false,
  ) {
    const targetBranchId = isAllBranchAdmin && query.branchId ? query.branchId : currentBranchId;

    const where: Prisma.SaleWhereInput = {
      business_id: businessId,
      ...(isAllBranchAdmin && !query.branchId ? {} : { branch_id: targetBranchId }),
      status: { not: SaleStatus.VOIDED },
      ...(query.startDate || query.endDate
        ? {
            sale_date: {
              ...(query.startDate && { gte: new Date(query.startDate) }),
              ...(query.endDate && { lte: new Date(query.endDate) }),
            },
          }
        : {}),
    };

    const saleItems = await this.prisma.saleItem.findMany({
      where: {
        sale: where,
      },
      include: {
        variant: {
          include: {
            product: {
              include: {
                brand: true,
                category: true,
              },
            },
          },
        },
      },
    });

    const groupMap = new Map<
      string,
      { id: string; name: string; quantity: number; revenue: number; cost: number; profit: number }
    >();

    for (const item of saleItems) {
      let keyId: string;
      let keyName: string;

      if (groupBy === 'brand') {
        keyId = item.variant.product.brand?.id || 'unbranded';
        keyName = item.variant.product.brand?.name || 'Unbranded';
      } else if (groupBy === 'category') {
        keyId = item.variant.product.category?.id || 'uncategorized';
        keyName = item.variant.product.category?.name || 'Uncategorized';
      } else {
        keyId = item.variant.product.id;
        keyName = item.variant.product.name;
      }

      const entry = groupMap.get(keyId) || {
        id: keyId,
        name: keyName,
        quantity: 0,
        revenue: 0,
        cost: 0,
        profit: 0,
      };

      entry.quantity += Number(item.quantity);
      entry.revenue += Number(item.total_amount);
      entry.cost += Number(item.total_cost);
      entry.profit = entry.revenue - entry.cost;
      groupMap.set(keyId, entry);
    }

    return {
      groupBy,
      data: Array.from(groupMap.values()).map((g) => ({
        ...g,
        quantity: Math.round(g.quantity * 100) / 100,
        revenue: Math.round(g.revenue * 100) / 100,
        cost: Math.round(g.cost * 100) / 100,
        profit: Math.round(g.profit * 100) / 100,
      })),
    };
  }

  // ----------------------------------------------------
  // HELPERS
  // ----------------------------------------------------
  private computePayloadHash(dto: CreateSaleDto): string {
    const clone = { ...dto };
    delete (clone as any).idempotencyKey;
    return crypto.createHash('sha256').update(JSON.stringify(clone)).digest('hex');
  }

  private getSaleIncludeConfig() {
    return {
      customer: { select: { id: true, name: true, phone: true, current_due: true, loyalty_points: true } },
      branch: { select: { id: true, name: true, code: true, address: true, phone: true } },
      cash_register: { select: { id: true, name: true, code: true } },
      coupon: { select: { id: true, code: true } },
      items: {
        include: {
          variant: {
            select: {
              id: true,
              sku: true,
              barcode: true,
              product: { select: { id: true, name: true, code: true } },
              size: { select: { name: true } },
              color: { select: { name: true } },
            },
          },
          product_unit: { select: { id: true, barcode_value: true } },
        },
      },
      payments: {
        select: {
          id: true,
          payment_method: true,
          amount: true,
          transaction_no: true,
          payment_date: true,
        },
      },
    };
  }

  private formatSaleInvoiceResponse(sale: any, autoTransfers?: any[]) {
    return {
      id: sale.id,
      invoiceNo: sale.invoice_no,
      saleDate: sale.sale_date,
      saleType: sale.sale_type,
      status: sale.status,
      branch: sale.branch,
      cashRegister: sale.cash_register,
      customer: sale.customer
        ? {
            id: sale.customer.id,
            name: sale.customer.name,
            phone: sale.customer.phone,
            currentDue: Number(sale.customer.current_due),
            loyaltyPoints: sale.customer.loyalty_points,
          }
        : null,
      subtotal: Number(sale.subtotal),
      discountAmount: Number(sale.discount_amount),
      coupon: sale.coupon?.code || null,
      taxAmount: Number(sale.tax_amount),
      roundOff: Number(sale.round_off),
      totalAmount: Number(sale.total_amount),
      paidAmount: Number(sale.paid_amount),
      dueAmount: Number(sale.due_amount),
      changeAmount: Number(sale.change_amount),
      totalCost: Number(sale.total_cost),
      isOffline: sale.is_offline,
      voidedAt: sale.voided_at,
      voidReason: sale.void_reason,
      items: sale.items.map((i: any) => ({
        id: i.id,
        variantId: i.product_variant_id,
        sku: i.variant.sku,
        productName: i.variant.product.name,
        size: i.variant.size?.name || null,
        color: i.variant.color?.name || null,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unit_price),
        unitCost: Number(i.unit_cost),
        discountAmount: Number(i.discount_amount),
        taxAmount: Number(i.tax_amount),
        totalAmount: Number(i.total_amount),
        totalCost: Number(i.total_cost),
        productUnitBarcode: i.product_unit?.barcode_value || null,
      })),
      payments: sale.payments.map((p: any) => ({
        id: p.id,
        method: p.payment_method,
        amount: Number(p.amount),
        transactionNo: p.transaction_no,
        date: p.payment_date,
      })),
      autoTransfers: autoTransfers && autoTransfers.length > 0 ? autoTransfers : undefined,
    };
  }
}
