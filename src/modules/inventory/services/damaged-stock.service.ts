import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { StockService } from './stock.service.js';
import {
  ReportDamagedStockDto,
  DamagedStockQueryDto,
} from '../dto/damaged-stock.dto.js';
import { Prisma } from '../../../generated/prisma/client.js';

@Injectable()
export class DamagedStockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
  ) {}

  async reportDamagedStock(
    businessId: string,
    branchId: string,
    userId: string,
    dto: ReportDamagedStockDto,
  ) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: dto.variantId, business_id: businessId, deleted_at: null },
    });

    if (!variant) {
      throw new NotFoundException(`Product variant with ID "${dto.variantId}" not found.`);
    }

    const balance = await this.prisma.stockBalance.findUnique({
      where: {
        business_id_branch_id_product_variant_id: {
          business_id: businessId,
          branch_id: branchId,
          product_variant_id: dto.variantId,
        },
      },
    });

    const currentWac = new Prisma.Decimal(balance ? balance.avg_cost_price : variant.cost_price);
    const qty = new Prisma.Decimal(dto.quantity);
    const estimatedLoss = qty.times(currentWac).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    const count = await this.prisma.damagedStock.count({
      where: { business_id: businessId, branch_id: branchId },
    });
    const damageNo = `DMG-${String(count + 1).padStart(6, '0')}`;

    return this.prisma.damagedStock.create({
      data: {
        business_id: businessId,
        branch_id: branchId,
        damage_no: damageNo,
        product_variant_id: dto.variantId,
        quantity: qty,
        unit_cost: currentWac,
        total_loss: estimatedLoss,
        reason: dto.reason.trim(),
        status: 'PENDING',
        reported_by: userId,
      },
      include: {
        variant: { select: { sku: true, barcode: true, product: { select: { name: true } } } },
      },
    });
  }

  async approveDamagedStock(
    businessId: string,
    branchId: string,
    userId: string,
    id: string,
  ) {
    const damage = await this.prisma.damagedStock.findFirst({
      where: { id, business_id: businessId, branch_id: branchId },
    });

    if (!damage) {
      throw new NotFoundException(`Damaged stock record with ID "${id}" not found.`);
    }

    if (damage.status !== 'PENDING') {
      throw new BadRequestException(`Only PENDING damaged stock can be approved (current: ${damage.status}).`);
    }

    return this.prisma.damagedStock.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approved_by: userId,
      },
    });
  }

  async writeOffDamagedStock(
    businessId: string,
    branchId: string,
    userId: string,
    id: string,
  ) {
    const damage = await this.prisma.damagedStock.findFirst({
      where: { id, business_id: businessId, branch_id: branchId },
    });

    if (!damage) {
      throw new NotFoundException(`Damaged stock record with ID "${id}" not found.`);
    }

    if (damage.status !== 'APPROVED') {
      throw new BadRequestException(`Only APPROVED damaged stock can be written off (current: ${damage.status}).`);
    }

    return this.prisma.$transaction(async (tx) => {
      // Stock-out movement (DAMAGE) using current WAC at this exact moment
      const movementResult = await this.stockService.applyMovement(tx, {
        businessId,
        branchId,
        variantId: damage.product_variant_id,
        movementType: 'DAMAGE',
        quantity: damage.quantity,
        referenceType: 'ADJUSTMENT',
        referenceId: damage.id,
        createdBy: userId,
        remarks: `Damaged stock write-off: ${damage.damage_no}`,
      });

      const actualUnitCost = movementResult.newWac;
      const actualTotalLoss = new Prisma.Decimal(damage.quantity)
        .times(actualUnitCost)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

      return tx.damagedStock.update({
        where: { id },
        data: {
          status: 'WRITTEN_OFF',
          unit_cost: actualUnitCost,
          total_loss: actualTotalLoss,
        },
        include: {
          variant: { select: { sku: true, barcode: true, product: { select: { name: true } } } },
        },
      });
    });
  }

  async listDamagedStock(
    businessId: string,
    branchId: string,
    query: DamagedStockQueryDto,
  ) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Number(query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.DamagedStockWhereInput = {
      business_id: businessId,
      branch_id: branchId,
      ...(query.status && { status: query.status }),
    };

    const [total, records] = await Promise.all([
      this.prisma.damagedStock.count({ where }),
      this.prisma.damagedStock.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          variant: { select: { sku: true, barcode: true, product: { select: { name: true } } } },
        },
      }),
    ]);

    return {
      data: records,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
