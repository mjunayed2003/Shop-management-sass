import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { StockService } from './stock.service.js';
import {
  CreateStockAdjustmentDto,
  StockAdjustmentQueryDto,
} from '../dto/stock-adjustment.dto.js';
import { Prisma } from '../../../generated/prisma/client.js';

@Injectable()
export class StockAdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
  ) {}

  async createAdjustment(
    businessId: string,
    branchId: string,
    userId: string,
    dto: CreateStockAdjustmentDto,
  ) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('At least one adjustment item is required.');
    }

    const variantIds = dto.items.map((i) => i.variantId);
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds }, business_id: businessId, deleted_at: null },
    });
    if (variants.length !== variantIds.length) {
      throw new BadRequestException('One or more product variants were not found.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Adjustment sequence number: ADJ-timestamp-counter
      const count = await tx.stockAdjustment.count({
        where: { business_id: businessId, branch_id: branchId },
      });
      const adjustmentNo = `ADJ-${String(count + 1).padStart(6, '0')}`;

      // Snapshot current system_qty and avg_cost_price
      const itemsData = await Promise.all(
        dto.items.map(async (i) => {
          const bal = await tx.stockBalance.findUnique({
            where: {
              business_id_branch_id_product_variant_id: {
                business_id: businessId,
                branch_id: branchId,
                product_variant_id: i.variantId,
              },
            },
          });

          const systemQty = new Prisma.Decimal(bal ? bal.quantity : 0);
          const physicalQty = new Prisma.Decimal(i.physicalQty);
          const differenceQty = physicalQty.minus(systemQty);
          const unitCost = new Prisma.Decimal(bal ? bal.avg_cost_price : 0);

          return {
            product_variant_id: i.variantId,
            system_qty: systemQty,
            physical_qty: physicalQty,
            difference_qty: differenceQty,
            unit_cost: unitCost,
          };
        }),
      );

      return tx.stockAdjustment.create({
        data: {
          business_id: businessId,
          branch_id: branchId,
          adjustment_no: adjustmentNo,
          reason: dto.reason,
          status: 'DRAFT',
          notes: dto.notes?.trim() || null,
          created_by: userId,
          items: {
            create: itemsData,
          },
        },
        include: { items: true },
      });
    });
  }

  async listAdjustments(
    businessId: string,
    branchId: string,
    query: StockAdjustmentQueryDto,
  ) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Number(query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.StockAdjustmentWhereInput = {
      business_id: businessId,
      branch_id: branchId,
      ...(query.status && { status: query.status }),
      ...(query.search && {
        adjustment_no: { contains: query.search, mode: 'insensitive' },
      }),
    };

    const [total, adjustments] = await Promise.all([
      this.prisma.stockAdjustment.count({ where }),
      this.prisma.stockAdjustment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          items: {
            include: {
              variant: { select: { sku: true, barcode: true, product: { select: { name: true } } } },
            },
          },
        },
      }),
    ]);

    return {
      data: adjustments,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getAdjustmentById(businessId: string, branchId: string, id: string) {
    const adjustment = await this.prisma.stockAdjustment.findFirst({
      where: { id, business_id: businessId, branch_id: branchId },
      include: {
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

    if (!adjustment) {
      throw new NotFoundException(`Stock Adjustment with ID "${id}" not found.`);
    }

    return adjustment;
  }

  /**
   * Approve a Stock Adjustment:
   * Stock changes ONLY on approval.
   * Approval check: creator must not be the approver unless owner.
   */
  async approveAdjustment(
    businessId: string,
    branchId: string,
    userId: string,
    isOwner: boolean,
    id: string,
  ) {
    const adjustment = await this.getAdjustmentById(businessId, branchId, id);

    if (adjustment.status !== 'DRAFT') {
      throw new BadRequestException(`Cannot approve an adjustment with status "${adjustment.status}".`);
    }

    // Separation of duties rule
    if (adjustment.created_by === userId && !isOwner) {
      throw new ForbiddenException(
        'The creator cannot approve their own stock adjustment unless they are the business owner.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      for (const item of adjustment.items) {
        const diff = new Prisma.Decimal(item.difference_qty);
        if (diff.isZero()) continue;

        if (diff.greaterThan(0)) {
          // Positive adjustment: stock-in
          await this.stockService.applyMovement(tx, {
            businessId,
            branchId,
            variantId: item.product_variant_id,
            movementType: 'ADJUSTMENT_POSITIVE',
            quantity: diff,
            unitCost: item.unit_cost,
            referenceType: 'ADJUSTMENT',
            referenceId: adjustment.id,
            createdBy: userId,
            remarks: `Adjustment ${adjustment.adjustment_no} approved (positive)`,
          });
        } else {
          // Negative adjustment: stock-out
          await this.stockService.applyMovement(tx, {
            businessId,
            branchId,
            variantId: item.product_variant_id,
            movementType: 'ADJUSTMENT_NEGATIVE',
            quantity: diff.abs(),
            referenceType: 'ADJUSTMENT',
            referenceId: adjustment.id,
            createdBy: userId,
            remarks: `Adjustment ${adjustment.adjustment_no} approved (negative)`,
          });
        }
      }

      return tx.stockAdjustment.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approved_by: userId,
          approved_at: new Date(),
        },
        include: { items: true },
      });
    });
  }

  async cancelAdjustment(businessId: string, branchId: string, id: string) {
    const adjustment = await this.getAdjustmentById(businessId, branchId, id);
    if (adjustment.status !== 'DRAFT') {
      throw new BadRequestException(`Cannot cancel an adjustment with status "${adjustment.status}".`);
    }

    return this.prisma.stockAdjustment.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }
}
