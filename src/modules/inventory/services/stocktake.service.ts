import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  StartStocktakeDto,
  RecordStocktakeCountsDto,
  CompleteStocktakeDto,
  StocktakeQueryDto,
} from '../dto/stocktake.dto.js';
import { Prisma } from '../../../generated/prisma/client.js';

@Injectable()
export class StocktakeService {
  constructor(private readonly prisma: PrismaService) {}

  async startStocktake(
    businessId: string,
    branchId: string,
    userId: string,
    dto: StartStocktakeDto,
  ) {
    // Check rule: Only ONE IN_PROGRESS stocktake per branch
    const existingActive = await this.prisma.stocktake.findFirst({
      where: {
        business_id: businessId,
        branch_id: branchId,
        status: 'IN_PROGRESS',
      },
    });

    if (existingActive) {
      throw new BadRequestException(
        `There is already an active stocktake in progress for this branch (${existingActive.stocktake_no}). Complete or cancel it first.`,
      );
    }

    // Query active variants matching optional filters
    const variants = await this.prisma.productVariant.findMany({
      where: {
        business_id: businessId,
        deleted_at: null,
        is_active: true,
        ...(dto.categoryId || dto.brandId
          ? {
              product: {
                ...(dto.categoryId && { category_id: dto.categoryId }),
                ...(dto.brandId && { brand_id: dto.brandId }),
              },
            }
          : {}),
      },
      select: { id: true },
    });

    if (variants.length === 0) {
      throw new BadRequestException('No matching product variants found for stocktake.');
    }

    return this.prisma.$transaction(async (tx) => {
      const count = await tx.stocktake.count({
        where: { business_id: businessId, branch_id: branchId },
      });
      const stocktakeNo = `STK-${String(count + 1).padStart(6, '0')}`;

      // Snapshot system quantities
      const itemsData = await Promise.all(
        variants.map(async (v) => {
          const bal = await tx.stockBalance.findUnique({
            where: {
              business_id_branch_id_product_variant_id: {
                business_id: businessId,
                branch_id: branchId,
                product_variant_id: v.id,
              },
            },
          });

          const sysQty = new Prisma.Decimal(bal ? bal.quantity : 0);
          return {
            product_variant_id: v.id,
            system_qty: sysQty,
            counted_qty: new Prisma.Decimal(0),
            discrepancy_qty: sysQty.negated(),
          };
        }),
      );

      return tx.stocktake.create({
        data: {
          business_id: businessId,
          branch_id: branchId,
          stocktake_no: stocktakeNo,
          status: 'IN_PROGRESS',
          started_at: new Date(),
          started_by: userId,
          notes: dto.notes?.trim() || null,
          items: {
            create: itemsData,
          },
        },
        include: { items: true },
      });
    });
  }

  async recordCounts(
    businessId: string,
    branchId: string,
    id: string,
    dto: RecordStocktakeCountsDto,
  ) {
    const stocktake = await this.prisma.stocktake.findFirst({
      where: { id, business_id: businessId, branch_id: branchId },
      include: { items: true },
    });

    if (!stocktake) {
      throw new NotFoundException(`Stocktake with ID "${id}" not found.`);
    }

    if (stocktake.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Counts can only be recorded on IN_PROGRESS stocktakes.');
    }

    return this.prisma.$transaction(async (tx) => {
      for (const count of dto.counts) {
        const item = stocktake.items.find((i) => i.id === count.itemId);
        if (!item) continue;

        const counted = new Prisma.Decimal(count.countedQty);
        const discrepancy = counted.minus(new Prisma.Decimal(item.system_qty));

        await tx.stocktakeItem.update({
          where: { id: item.id },
          data: {
            counted_qty: counted,
            discrepancy_qty: discrepancy,
          },
        });
      }

      return tx.stocktake.findUniqueOrThrow({
        where: { id },
        include: { items: true },
      });
    });
  }

  async completeStocktake(
    businessId: string,
    branchId: string,
    userId: string,
    id: string,
    dto: CompleteStocktakeDto,
  ) {
    const stocktake = await this.prisma.stocktake.findFirst({
      where: { id, business_id: businessId, branch_id: branchId },
      include: { items: true },
    });

    if (!stocktake) {
      throw new NotFoundException(`Stocktake with ID "${id}" not found.`);
    }

    if (stocktake.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Only IN_PROGRESS stocktakes can be completed.');
    }

    return this.prisma.$transaction(async (tx) => {
      let createdAdjustment: any = null;

      // Optionally generate DRAFT StockAdjustment from discrepancies
      if (dto.createAdjustment) {
        const discrepancyItems = stocktake.items.filter(
          (i) => !new Prisma.Decimal(i.discrepancy_qty).isZero(),
        );

        if (discrepancyItems.length > 0) {
          const adjCount = await tx.stockAdjustment.count({
            where: { business_id: businessId, branch_id: branchId },
          });
          const adjNo = `ADJ-${String(adjCount + 1).padStart(6, '0')}`;

          const adjItemsData = await Promise.all(
            discrepancyItems.map(async (i) => {
              const bal = await tx.stockBalance.findUnique({
                where: {
                  business_id_branch_id_product_variant_id: {
                    business_id: businessId,
                    branch_id: branchId,
                    product_variant_id: i.product_variant_id,
                  },
                },
              });
              return {
                product_variant_id: i.product_variant_id,
                system_qty: i.system_qty,
                physical_qty: i.counted_qty,
                difference_qty: i.discrepancy_qty,
                unit_cost: new Prisma.Decimal(bal ? bal.avg_cost_price : 0),
              };
            }),
          );

          createdAdjustment = await tx.stockAdjustment.create({
            data: {
              business_id: businessId,
              branch_id: branchId,
              adjustment_no: adjNo,
              reason: 'PHYSICAL_COUNT_DISCREPANCY',
              status: 'DRAFT',
              notes: `Auto-generated from completed stocktake ${stocktake.stocktake_no}`,
              created_by: userId,
              items: {
                create: adjItemsData,
              },
            },
            include: { items: true },
          });
        }
      }

      const completed = await tx.stocktake.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          completed_at: new Date(),
          completed_by: userId,
        },
        include: { items: true },
      });

      return {
        stocktake: completed,
        generatedAdjustment: createdAdjustment,
      };
    });
  }

  async cancelStocktake(businessId: string, branchId: string, id: string) {
    const stocktake = await this.prisma.stocktake.findFirst({
      where: { id, business_id: businessId, branch_id: branchId },
    });

    if (!stocktake) {
      throw new NotFoundException(`Stocktake with ID "${id}" not found.`);
    }

    if (stocktake.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Only IN_PROGRESS stocktakes can be cancelled.');
    }

    return this.prisma.stocktake.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }

  async listStocktakes(
    businessId: string,
    branchId: string,
    query: StocktakeQueryDto,
  ) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Number(query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.StocktakeWhereInput = {
      business_id: businessId,
      branch_id: branchId,
      ...(query.status && { status: query.status }),
    };

    const [total, stocktakes] = await Promise.all([
      this.prisma.stocktake.count({ where }),
      this.prisma.stocktake.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          items: true,
        },
      }),
    ]);

    return {
      data: stocktakes,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getStocktakeById(businessId: string, branchId: string, id: string) {
    const stocktake = await this.prisma.stocktake.findFirst({
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

    if (!stocktake) {
      throw new NotFoundException(`Stocktake with ID "${id}" not found.`);
    }

    return stocktake;
  }
}
