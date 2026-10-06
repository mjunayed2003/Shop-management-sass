import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { StockService } from './stock.service.js';
import { SequenceService } from './sequence.service.js';
import { CreatePurchaseDto, PurchaseQueryDto } from '../dto/purchase.dto.js';
import { Prisma } from '../../../generated/prisma/client.js';

@Injectable()
export class PurchaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
    private readonly sequenceService: SequenceService,
  ) {}

  async createPurchase(
    businessId: string,
    branchId: string,
    userId: string,
    dto: CreatePurchaseDto,
  ) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('At least one purchase item is required.');
    }

    // 1. Verify Supplier
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, business_id: businessId, deleted_at: null },
    });
    if (!supplier) {
      throw new NotFoundException(`Supplier with ID "${dto.supplierId}" not found.`);
    }

    // 2. Verify all variants are active and not deleted
    const variantIds = dto.items.map((i) => i.variantId);
    const variants = await this.prisma.productVariant.findMany({
      where: {
        id: { in: variantIds },
        business_id: businessId,
        deleted_at: null,
      },
      include: {
        product: { select: { id: true, name: true, track_individually: true, deleted_at: true } },
      },
    });

    if (variants.length !== variantIds.length) {
      throw new BadRequestException('One or more product variants do not exist or were deleted.');
    }

    const variantMap = new Map(variants.map((v) => [v.id, v]));

    for (const item of dto.items) {
      const v = variantMap.get(item.variantId);
      if (!v || !v.is_active || v.product.deleted_at !== null) {
        throw new BadRequestException(`Variant "${v?.sku || item.variantId}" is inactive or product was deleted.`);
      }
      if (item.quantity <= 0) {
        throw new BadRequestException(`Item quantity must be greater than zero.`);
      }
      if (item.unitCost < 0) {
        throw new BadRequestException(`Item unit cost cannot be negative.`);
      }
      if (v.product.track_individually && !Number.isInteger(Number(item.quantity))) {
        throw new BadRequestException(
          `Product "${v.product.name}" is individually tracked: quantity must be an integer (received: ${item.quantity}).`,
        );
      }
    }

    // 3. Optional Purchase Order validation
    let poRecord: any = null;
    if (dto.purchaseOrderId) {
      poRecord = await this.prisma.purchaseOrder.findFirst({
        where: {
          id: dto.purchaseOrderId,
          business_id: businessId,
          branch_id: branchId,
        },
        include: { items: true },
      });
      if (!poRecord) {
        throw new NotFoundException(`Purchase Order with ID "${dto.purchaseOrderId}" not found.`);
      }
      if (poRecord.status === 'COMPLETED' || poRecord.status === 'CANCELLED') {
        throw new BadRequestException(`Purchase order is already ${poRecord.status}.`);
      }
    }

    // 4. Calculations with Decimal
    const discountAmount = new Prisma.Decimal(dto.discountAmount || 0);
    const taxAmount = new Prisma.Decimal(dto.taxAmount || 0);
    const shippingCost = new Prisma.Decimal(dto.shippingCost || 0);
    const paidAmount = new Prisma.Decimal(dto.paidAmount || 0);

    let subtotal = new Prisma.Decimal(0);
    for (const item of dto.items) {
      const q = new Prisma.Decimal(item.quantity);
      const c = new Prisma.Decimal(item.unitCost);
      subtotal = subtotal.plus(q.times(c));
    }

    const totalAmount = subtotal.minus(discountAmount).plus(taxAmount).plus(shippingCost);

    if (paidAmount.greaterThan(totalAmount)) {
      throw new BadRequestException(
        `Paid amount (${paidAmount.toString()}) cannot exceed total purchase amount (${totalAmount.toString()}).`,
      );
    }

    const dueAmount = totalAmount.minus(paidAmount);
    const status = paidAmount.greaterThanOrEqualTo(totalAmount)
      ? 'PAID'
      : paidAmount.greaterThan(0)
      ? 'PARTIALLY_PAID'
      : 'RECEIVED';

    // 5. Execute in ONE atomic transaction
    return this.prisma.$transaction(async (tx) => {
      // Sequence generation
      const purchaseNo = await this.sequenceService.getNextNumber(
        tx,
        businessId,
        branchId,
        'PURCHASE_INVOICE',
        'PUR-',
      );

      // Create Purchase record
      const purchase = await tx.purchase.create({
        data: {
          business_id: businessId,
          branch_id: branchId,
          supplier_id: dto.supplierId,
          purchase_order_id: dto.purchaseOrderId || null,
          purchase_no: purchaseNo,
          supplier_invoice_no: dto.supplierInvoiceNo?.trim() || null,
          purchase_date: dto.purchaseDate ? new Date(dto.purchaseDate) : new Date(),
          subtotal,
          discount_amount: discountAmount,
          tax_amount: taxAmount,
          shipping_cost: shippingCost,
          total_amount: totalAmount,
          paid_amount: paidAmount,
          due_amount: dueAmount,
          status,
          notes: dto.notes?.trim() || null,
          created_by: userId,
        },
      });

      // Landed cost adjustment calculation per item
      // Net landed overhead = shipping - discount
      const netLandedOverhead = shippingCost.minus(discountAmount);
      const createdUnits: Array<any> = [];

      for (const item of dto.items) {
        const v = variantMap.get(item.variantId)!;
        const itemQty = new Prisma.Decimal(item.quantity);
        const itemBaseCost = new Prisma.Decimal(item.unitCost);
        const itemTotal = itemQty.times(itemBaseCost);

        let effectiveUnitCost = itemBaseCost;
        if (dto.landedCost && subtotal.greaterThan(0)) {
          const proportion = itemTotal.dividedBy(subtotal);
          const allocatedOverhead = netLandedOverhead.times(proportion);
          const effectiveTotal = itemTotal.plus(allocatedOverhead);
          effectiveUnitCost = effectiveTotal.dividedBy(itemQty).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        }

        // Create PurchaseItem
        await tx.purchaseItem.create({
          data: {
            purchase_id: purchase.id,
            product_variant_id: item.variantId,
            quantity: itemQty,
            unit_cost: itemBaseCost,
            total_amount: itemTotal,
            vat_percentage: new Prisma.Decimal(item.vatPercentage || 0),
          },
        });

        // Apply Stock Movement via StockService (THE SINGLE ENTRY POINT)
        await this.stockService.applyMovement(tx, {
          businessId,
          branchId,
          variantId: item.variantId,
          movementType: 'PURCHASE',
          quantity: itemQty,
          unitCost: effectiveUnitCost,
          referenceType: 'PURCHASE',
          referenceId: purchase.id,
          createdBy: userId,
          remarks: `Purchase ${purchaseNo}`,
        });

        // Individually tracked products: generate ProductUnits
        if (v.product.track_individually) {
          const qtyCount = itemQty.toNumber();
          const timestamp = Date.now().toString(36).toUpperCase();
          for (let idx = 1; idx <= qtyCount; idx++) {
            const unitBarcode = `${v.sku}-${timestamp}-${idx.toString().padStart(4, '0')}`;
            const unit = await tx.productUnit.create({
              data: {
                business_id: businessId,
                branch_id: branchId,
                product_variant_id: v.id,
                barcode_value: unitBarcode,
                status: 'IN_STOCK',
                purchase_id: purchase.id,
              },
            });
            createdUnits.push({
              id: unit.id,
              barcodeValue: unit.barcode_value,
              variantId: v.id,
              sku: v.sku,
              status: unit.status,
            });
          }
        }

        // Update PO item received quantity if linked to a PO
        if (poRecord) {
          const poItem = poRecord.items.find((poi: any) => poi.product_variant_id === item.variantId);
          if (poItem) {
            const newReceivedQty = new Prisma.Decimal(poItem.received_quantity).plus(itemQty);
            await tx.purchaseOrderItem.update({
              where: { id: poItem.id },
              data: { received_quantity: newReceivedQty },
            });
          }
        }
      }

      // Update PO status if all items received
      if (poRecord) {
        const updatedPoItems = await tx.purchaseOrderItem.findMany({
          where: { purchase_order_id: poRecord.id },
        });
        const allReceived = updatedPoItems.every((poi) =>
          new Prisma.Decimal(poi.received_quantity).greaterThanOrEqualTo(new Prisma.Decimal(poi.quantity)),
        );
        await tx.purchaseOrder.update({
          where: { id: poRecord.id },
          data: { status: allReceived ? 'COMPLETED' : 'PARTIALLY_RECEIVED' },
        });
      }

      // Record Supplier Payment if paid_amount > 0
      if (paidAmount.greaterThan(0)) {
        const paymentNo = await this.sequenceService.getNextNumber(
          tx,
          businessId,
          branchId,
          'EXPENSE_VOUCHER',
          'PAY-',
        );
        await tx.supplierPayment.create({
          data: {
            business_id: businessId,
            branch_id: branchId,
            supplier_id: dto.supplierId,
            purchase_id: purchase.id,
            payment_account_id: null, // Accounting payment_account_id stays null
            payment_no: paymentNo,
            amount: paidAmount,
            payment_method: dto.paymentMethod || 'BANK',
            reference_no: dto.paymentReference || null,
            payment_date: new Date(),
            notes: `Initial payment for purchase ${purchaseNo}`,
            created_by: userId,
          },
        });
      }

      // Update Supplier balance by the DUE amount
      if (dueAmount.greaterThan(0)) {
        await tx.supplier.update({
          where: { id: dto.supplierId },
          data: {
            current_balance: {
              increment: dueAmount,
            },
          },
        });
      }

      return {
        ...purchase,
        productUnits: createdUnits,
      };
    });
  }

  async listPurchases(businessId: string, branchId: string, query: PurchaseQueryDto) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Number(query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.PurchaseWhereInput = {
      business_id: businessId,
      branch_id: branchId,
      ...(query.status && { status: query.status }),
      ...(query.supplierId && { supplier_id: query.supplierId }),
      ...(query.search && {
        OR: [
          { purchase_no: { contains: query.search, mode: 'insensitive' } },
          { supplier_invoice_no: { contains: query.search, mode: 'insensitive' } },
          { supplier: { name: { contains: query.search, mode: 'insensitive' } } },
        ],
      }),
      ...(query.startDate || query.endDate
        ? {
            purchase_date: {
              ...(query.startDate && { gte: new Date(query.startDate) }),
              ...(query.endDate && { lte: new Date(query.endDate) }),
            },
          }
        : {}),
    };

    const [total, purchases] = await Promise.all([
      this.prisma.purchase.count({ where }),
      this.prisma.purchase.findMany({
        where,
        skip,
        take: limit,
        orderBy: { purchase_date: 'desc' },
        include: {
          supplier: { select: { id: true, name: true, code: true } },
          items: {
            include: {
              variant: {
                select: {
                  sku: true,
                  barcode: true,
                  product: { select: { name: true } },
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      data: purchases,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getPurchaseById(businessId: string, branchId: string, id: string) {
    const purchase = await this.prisma.purchase.findFirst({
      where: { id, business_id: businessId, branch_id: branchId },
      include: {
        supplier: true,
        items: {
          include: {
            variant: {
              include: {
                product: true,
                size: true,
                color: true,
              },
            },
          },
        },
        payments: true,
        product_units: true,
        purchase_returns: true,
      },
    });

    if (!purchase) {
      throw new NotFoundException(`Purchase with ID "${id}" not found.`);
    }

    return purchase;
  }

  /**
   * Cancel a purchase:
   * Blocked if any item has been sold, transferred, or returned out.
   * Reverses stock via movements, never deletes rows.
   * Reverses supplier balance.
   */
  async cancelPurchase(businessId: string, branchId: string, userId: string, id: string) {
    const purchase = await this.getPurchaseById(businessId, branchId, id);

    if (purchase.status === 'CANCELLED') {
      throw new BadRequestException('This purchase has already been cancelled.');
    }

    // 1. Check if any items were returned via PurchaseReturn
    if (purchase.purchase_returns && purchase.purchase_returns.length > 0) {
      const activeReturns = purchase.purchase_returns.filter((r) => r.status !== 'CANCELLED');
      if (activeReturns.length > 0) {
        throw new BadRequestException('Cannot cancel purchase: it has active purchase returns linked.');
      }
    }

    // 2. Check ProductUnit status (for individually tracked items)
    if (purchase.product_units && purchase.product_units.length > 0) {
      const notInStock = purchase.product_units.filter((u) => u.status !== 'IN_STOCK');
      if (notInStock.length > 0) {
        throw new BadRequestException(
          `Cannot cancel purchase: ${notInStock.length} individually tracked unit(s) have been sold or moved (status: ${notInStock[0].status}).`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // 3. Check stock balance sufficiency for each purchase item
      for (const item of purchase.items) {
        const bal = await tx.stockBalance.findUnique({
          where: {
            business_id_branch_id_product_variant_id: {
              business_id: businessId,
              branch_id: branchId,
              product_variant_id: item.product_variant_id,
            },
          },
        });

        const available = bal
          ? Number(bal.quantity) - Number(bal.allocated_quantity)
          : 0;

        if (available < Number(item.quantity)) {
          throw new BadRequestException(
            `Cannot cancel purchase: stock for variant "${item.variant.sku}" has already been sold or moved (available: ${available}, needed to reverse: ${item.quantity}).`,
          );
        }

        // Reverse stock via StockService (stock-out movement)
        await this.stockService.applyMovement(tx, {
          businessId,
          branchId,
          variantId: item.product_variant_id,
          movementType: 'ADJUSTMENT_NEGATIVE',
          quantity: item.quantity,
          referenceType: 'PURCHASE',
          referenceId: purchase.id,
          createdBy: userId,
          remarks: `Purchase cancellation reversal for ${purchase.purchase_no}`,
        });
      }

      // 4. Update ProductUnits to RETURNED
      if (purchase.product_units && purchase.product_units.length > 0) {
        await tx.productUnit.updateMany({
          where: { purchase_id: purchase.id },
          data: { status: 'RETURNED' },
        });
      }

      // 5. Reverse Supplier balance by the unpaid due amount
      const due = new Prisma.Decimal(purchase.due_amount);
      if (due.greaterThan(0)) {
        await tx.supplier.update({
          where: { id: purchase.supplier_id },
          data: {
            current_balance: {
              decrement: due,
            },
          },
        });
      }

      // 6. Update Purchase status to CANCELLED
      return tx.purchase.update({
        where: { id: purchase.id },
        data: { status: 'CANCELLED' },
      });
    });
  }
}
