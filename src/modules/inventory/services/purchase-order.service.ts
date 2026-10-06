import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { SequenceService } from './sequence.service.js';
import {
  CreatePurchaseOrderDto,
  UpdatePurchaseOrderDto,
  PurchaseOrderQueryDto,
} from '../dto/purchase-order.dto.js';
import { Prisma } from '../../../generated/prisma/client.js';

@Injectable()
export class PurchaseOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequenceService: SequenceService,
  ) {}

  async createPurchaseOrder(
    businessId: string,
    branchId: string,
    userId: string,
    dto: CreatePurchaseOrderDto,
  ) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('At least one purchase order item is required.');
    }

    // Verify supplier exists
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, business_id: businessId, deleted_at: null },
    });
    if (!supplier) {
      throw new NotFoundException(`Supplier with ID "${dto.supplierId}" not found.`);
    }

    // Verify variants
    const variantIds = dto.items.map((i) => i.variantId);
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds }, business_id: businessId, deleted_at: null },
    });
    if (variants.length !== variantIds.length) {
      throw new BadRequestException('One or more product variants are invalid or deleted.');
    }

    return this.prisma.$transaction(async (tx) => {
      const poNo = await this.sequenceService.getNextNumber(
        tx,
        businessId,
        branchId,
        'PURCHASE_INVOICE',
        'PO-',
      );

      let totalAmount = new Prisma.Decimal(0);
      const itemsData = dto.items.map((item) => {
        const qty = new Prisma.Decimal(item.quantity);
        const cost = new Prisma.Decimal(item.unitCost);
        const itemTotal = qty.times(cost);
        totalAmount = totalAmount.plus(itemTotal);
        return {
          product_variant_id: item.variantId,
          quantity: qty,
          unit_cost: cost,
          total_amount: itemTotal,
          received_quantity: new Prisma.Decimal(0),
        };
      });

      return tx.purchaseOrder.create({
        data: {
          business_id: businessId,
          branch_id: branchId,
          supplier_id: dto.supplierId,
          po_no: poNo,
          order_date: new Date(),
          expected_delivery: dto.expectedDelivery ? new Date(dto.expectedDelivery) : null,
          status: 'DRAFT',
          total_amount: totalAmount,
          notes: dto.notes || null,
          created_by: userId,
          items: {
            create: itemsData,
          },
        },
        include: {
          items: true,
          supplier: true,
        },
      });
    });
  }

  async listPurchaseOrders(
    businessId: string,
    branchId: string,
    query: PurchaseOrderQueryDto,
  ) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Number(query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.PurchaseOrderWhereInput = {
      business_id: businessId,
      branch_id: branchId,
      ...(query.status && { status: query.status }),
      ...(query.supplierId && { supplier_id: query.supplierId }),
      ...(query.search && {
        OR: [
          { po_no: { contains: query.search, mode: 'insensitive' } },
          { supplier: { name: { contains: query.search, mode: 'insensitive' } } },
        ],
      }),
    };

    const [total, pos] = await Promise.all([
      this.prisma.purchaseOrder.count({ where }),
      this.prisma.purchaseOrder.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
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
      data: pos,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getPurchaseOrderById(businessId: string, branchId: string, id: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
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
      },
    });

    if (!po) {
      throw new NotFoundException(`Purchase Order with ID "${id}" not found.`);
    }

    return po;
  }

  async updatePurchaseOrder(
    businessId: string,
    branchId: string,
    id: string,
    dto: UpdatePurchaseOrderDto,
  ) {
    const po = await this.getPurchaseOrderById(businessId, branchId, id);

    if (po.status !== 'DRAFT') {
      throw new BadRequestException('Only purchase orders in DRAFT status can be modified.');
    }

    return this.prisma.$transaction(async (tx) => {
      let totalAmount = new Prisma.Decimal(po.total_amount);

      if (dto.items && dto.items.length > 0) {
        // Delete previous items
        await tx.purchaseOrderItem.deleteMany({
          where: { purchase_order_id: po.id },
        });

        totalAmount = new Prisma.Decimal(0);
        const newItems = dto.items.map((i) => {
          const qty = new Prisma.Decimal(i.quantity);
          const cost = new Prisma.Decimal(i.unitCost);
          const t = qty.times(cost);
          totalAmount = totalAmount.plus(t);
          return {
            purchase_order_id: po.id,
            product_variant_id: i.variantId,
            quantity: qty,
            unit_cost: cost,
            total_amount: t,
            received_quantity: new Prisma.Decimal(0),
          };
        });

        await tx.purchaseOrderItem.createMany({ data: newItems });
      }

      return tx.purchaseOrder.update({
        where: { id },
        data: {
          ...(dto.supplierId && { supplier_id: dto.supplierId }),
          ...(dto.expectedDelivery !== undefined && {
            expected_delivery: dto.expectedDelivery ? new Date(dto.expectedDelivery) : null,
          }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          total_amount: totalAmount,
        },
        include: { items: true, supplier: true },
      });
    });
  }

  async issuePurchaseOrder(businessId: string, branchId: string, id: string) {
    const po = await this.getPurchaseOrderById(businessId, branchId, id);
    if (po.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT purchase orders can be ISSUED.');
    }

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'ISSUED' },
    });
  }

  async cancelPurchaseOrder(businessId: string, branchId: string, id: string) {
    const po = await this.getPurchaseOrderById(businessId, branchId, id);
    if (po.status === 'COMPLETED' || po.status === 'CANCELLED') {
      throw new BadRequestException(`Cannot cancel a purchase order with status "${po.status}".`);
    }

    const hasReceived = po.items.some((i) => Number(i.received_quantity) > 0);
    if (hasReceived) {
      throw new BadRequestException('Cannot cancel a purchase order that has already received items.');
    }

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }
}
