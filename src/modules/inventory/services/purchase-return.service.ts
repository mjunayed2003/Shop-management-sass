import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { StockService } from './stock.service.js';
import { SequenceService } from './sequence.service.js';
import {
  CreatePurchaseReturnDto,
  PurchaseReturnQueryDto,
} from '../dto/purchase-return.dto.js';
import { Prisma } from '../../../generated/prisma/client.js';

@Injectable()
export class PurchaseReturnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
    private readonly sequenceService: SequenceService,
  ) {}

  async createReturn(
    businessId: string,
    branchId: string,
    userId: string,
    dto: CreatePurchaseReturnDto,
  ) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('At least one return item is required.');
    }

    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, business_id: businessId, deleted_at: null },
    });
    if (!supplier) {
      throw new NotFoundException(`Supplier with ID "${dto.supplierId}" not found.`);
    }

    let linkedPurchase: any = null;
    if (dto.purchaseId) {
      linkedPurchase = await this.prisma.purchase.findFirst({
        where: {
          id: dto.purchaseId,
          business_id: businessId,
          branch_id: branchId,
          supplier_id: dto.supplierId,
        },
        include: {
          items: true,
          purchase_returns: {
            where: { status: 'COMPLETED' },
            include: { items: true },
          },
        },
      });

      if (!linkedPurchase) {
        throw new NotFoundException(`Purchase with ID "${dto.purchaseId}" not found.`);
      }

      if (linkedPurchase.status === 'CANCELLED') {
        throw new BadRequestException('Cannot return items from a cancelled purchase.');
      }

      // Validate quantities against purchased minus already returned
      for (const retItem of dto.items) {
        const pItem = linkedPurchase.items.find(
          (pi: any) => pi.product_variant_id === retItem.variantId,
        );
        if (!pItem) {
          throw new BadRequestException(
            `Variant "${retItem.variantId}" was not in the original purchase.`,
          );
        }

        let alreadyReturned = 0;
        for (const pr of linkedPurchase.purchase_returns) {
          for (const pri of pr.items) {
            if (pri.product_variant_id === retItem.variantId) {
              alreadyReturned += Number(pri.quantity);
            }
          }
        }

        const maxReturnable = Number(pItem.quantity) - alreadyReturned;
        if (retItem.quantity > maxReturnable) {
          throw new BadRequestException(
            `Return quantity (${retItem.quantity}) exceeds remaining returnable quantity (${maxReturnable}).`,
          );
        }
      }
    }

    const isCompleted = dto.status === 'COMPLETED';

    return this.prisma.$transaction(async (tx) => {
      const returnNo = await this.sequenceService.getNextNumber(
        tx,
        businessId,
        branchId,
        'RETURN_INVOICE',
        'RET-',
      );

      let totalAmount = new Prisma.Decimal(0);
      const returnItemsData = dto.items.map((i) => {
        const q = new Prisma.Decimal(i.quantity);
        const c = new Prisma.Decimal(i.unitCost);
        const itemTot = q.times(c);
        totalAmount = totalAmount.plus(itemTot);
        return {
          product_variant_id: i.variantId,
          quantity: q,
          unit_cost: c,
          total_amount: itemTot,
        };
      });

      const pReturn = await tx.purchaseReturn.create({
        data: {
          business_id: businessId,
          branch_id: branchId,
          supplier_id: dto.supplierId,
          purchase_id: dto.purchaseId || null,
          return_no: returnNo,
          return_date: new Date(),
          total_amount: totalAmount,
          status: isCompleted ? 'COMPLETED' : 'DRAFT',
          reason: dto.reason?.trim() || null,
          created_by: userId,
          items: {
            create: returnItemsData,
          },
        },
        include: { items: true, supplier: true },
      });

      if (isCompleted) {
        await this.applyReturnStockAndBalance(tx, businessId, branchId, userId, pReturn, dto.purchaseId);
      }

      return pReturn;
    });
  }

  private async applyReturnStockAndBalance(
    tx: Prisma.TransactionClient,
    businessId: string,
    branchId: string,
    userId: string,
    pReturn: any,
    purchaseId?: string,
  ) {
    for (const item of pReturn.items) {
      // 1. Stock-out movement
      await this.stockService.applyMovement(tx, {
        businessId,
        branchId,
        variantId: item.product_variant_id,
        movementType: 'ADJUSTMENT_NEGATIVE',
        quantity: item.quantity,
        referenceType: 'RETURN',
        referenceId: pReturn.id,
        createdBy: userId,
        remarks: `Purchase return ${pReturn.return_no}`,
      });

      // 2. Tracked units
      const trackedUnits = await tx.productUnit.findMany({
        where: {
          business_id: businessId,
          branch_id: branchId,
          product_variant_id: item.product_variant_id,
          status: 'IN_STOCK',
        },
        take: Number(item.quantity),
      });

      if (trackedUnits.length > 0) {
        await tx.productUnit.updateMany({
          where: { id: { in: trackedUnits.map((u) => u.id) } },
          data: { status: 'RETURNED' },
        });
      }
    }

    // 3. Decrement Supplier balance (reduces what we owe supplier)
    await tx.supplier.update({
      where: { id: pReturn.supplier_id },
      data: {
        current_balance: {
          decrement: pReturn.total_amount,
        },
      },
    });

    // 4. If linked to Purchase: reduce purchase due_amount
    if (purchaseId) {
      const pur = await tx.purchase.findUnique({ where: { id: purchaseId } });
      if (pur) {
        const curDue = new Prisma.Decimal(pur.due_amount);
        const retAmt = new Prisma.Decimal(pReturn.total_amount);
        const newDue = curDue.greaterThan(retAmt) ? curDue.minus(retAmt) : new Prisma.Decimal(0);
        await tx.purchase.update({
          where: { id: purchaseId },
          data: { due_amount: newDue },
        });
      }
    }
  }

  async listReturns(
    businessId: string,
    branchId: string,
    query: PurchaseReturnQueryDto,
  ) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Number(query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.PurchaseReturnWhereInput = {
      business_id: businessId,
      branch_id: branchId,
      ...(query.status && { status: query.status }),
      ...(query.supplierId && { supplier_id: query.supplierId }),
      ...(query.purchaseId && { purchase_id: query.purchaseId }),
    };

    const [total, returns] = await Promise.all([
      this.prisma.purchaseReturn.count({ where }),
      this.prisma.purchaseReturn.findMany({
        where,
        skip,
        take: limit,
        orderBy: { return_date: 'desc' },
        include: {
          supplier: { select: { id: true, name: true, code: true } },
          items: {
            include: {
              variant: { select: { sku: true, barcode: true, product: { select: { name: true } } } },
            },
          },
        },
      }),
    ]);

    return {
      data: returns,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getReturnById(businessId: string, branchId: string, id: string) {
    const ret = await this.prisma.purchaseReturn.findFirst({
      where: { id, business_id: businessId, branch_id: branchId },
      include: {
        supplier: true,
        purchase: true,
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
      },
    });

    if (!ret) {
      throw new NotFoundException(`Purchase Return with ID "${id}" not found.`);
    }

    return ret;
  }

  async completeReturn(businessId: string, branchId: string, userId: string, id: string) {
    const ret = await this.getReturnById(businessId, branchId, id);
    if (ret.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT purchase returns can be completed.');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.applyReturnStockAndBalance(
        tx,
        businessId,
        branchId,
        userId,
        ret,
        ret.purchase_id || undefined,
      );

      return tx.purchaseReturn.update({
        where: { id },
        data: { status: 'COMPLETED' },
        include: { items: true, supplier: true },
      });
    });
  }

  async cancelReturn(businessId: string, branchId: string, id: string) {
    const ret = await this.getReturnById(businessId, branchId, id);
    if (ret.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT purchase returns can be cancelled.');
    }

    return this.prisma.purchaseReturn.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }
}
