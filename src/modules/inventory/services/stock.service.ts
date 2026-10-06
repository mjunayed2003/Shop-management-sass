import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { ProductBranchService } from '../../catalog/services/product-branch.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
import type {
  StockMovementType,
  StockReferenceType,
} from '../../../generated/prisma/client.js';
import {
  CurrentStockQueryDto,
  StockMovementQueryDto,
  OpeningStockDto,
} from '../dto/stock-query.dto.js';

export interface ApplyStockMovementParams {
  businessId: string;
  branchId: string;
  variantId: string;
  movementType: StockMovementType;
  quantity: Prisma.Decimal | number | string;
  unitCost?: Prisma.Decimal | number | string;
  referenceType: StockReferenceType;
  referenceId: string;
  createdBy: string;
  remarks?: string | null;
  batchNo?: string | null;
  allowNegativeStock?: boolean;
}

export const STOCK_IN_TYPES: Set<StockMovementType> = new Set([
  'OPENING',
  'PURCHASE',
  'TRANSFER_IN',
  'SALE_RETURN',
  'EXCHANGE_IN',
  'ADJUSTMENT_POSITIVE',
]);

export const STOCK_OUT_TYPES: Set<StockMovementType> = new Set([
  'SALE',
  'TRANSFER_OUT',
  'DAMAGE',
  'ADJUSTMENT_NEGATIVE',
  'EXCHANGE_OUT',
]);

@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly productBranchService: ProductBranchService,
  ) {}

  /**
   * THE ONLY METHOD IN THE SYSTEM ALLOWED TO CHANGE StockBalance.
   * Runs inside an ongoing transaction with pessimistic row locking.
   */
  async applyMovement(
    tx: Prisma.TransactionClient,
    params: ApplyStockMovementParams,
  ) {
    const isStockIn = STOCK_IN_TYPES.has(params.movementType);
    const absQty = new Prisma.Decimal(params.quantity).abs();

    if (absQty.isZero()) {
      return {
        balance: await tx.stockBalance.findUnique({
          where: {
            business_id_branch_id_product_variant_id: {
              business_id: params.businessId,
              branch_id: params.branchId,
              product_variant_id: params.variantId,
            },
          },
        }),
        movement: null,
        newWac: new Prisma.Decimal(0),
      };
    }

    // 1. Ensure StockBalance record exists
    let balance = await tx.stockBalance.findUnique({
      where: {
        business_id_branch_id_product_variant_id: {
          business_id: params.businessId,
          branch_id: params.branchId,
          product_variant_id: params.variantId,
        },
      },
    });

    if (!balance) {
      balance = await tx.stockBalance.create({
        data: {
          business_id: params.businessId,
          branch_id: params.branchId,
          product_variant_id: params.variantId,
          quantity: new Prisma.Decimal(0),
          allocated_quantity: new Prisma.Decimal(0),
          avg_cost_price: new Prisma.Decimal(0),
          total_cost_value: new Prisma.Decimal(0),
        },
      });
    }

    // 2. Lock the row to prevent race conditions (SELECT FOR UPDATE)
    await tx.$queryRaw`
      SELECT id FROM stock_balances 
      WHERE id = ${balance.id}::uuid 
      FOR UPDATE
    `;

    // Re-read after acquiring lock
    balance = await tx.stockBalance.findUniqueOrThrow({
      where: { id: balance.id },
    });

    // 3. Fetch variant for reorder level, product ID, and SKU
    const variant = await tx.productVariant.findUniqueOrThrow({
      where: { id: params.variantId },
      select: {
        id: true,
        product_id: true,
        sku: true,
        reorder_level: true,
        cost_price: true,
      },
    });

    const oldQty = new Prisma.Decimal(balance.quantity);
    const oldValue = new Prisma.Decimal(balance.total_cost_value);
    const oldWac = new Prisma.Decimal(balance.avg_cost_price);

    let newQty: Prisma.Decimal;
    let newWac: Prisma.Decimal;
    let newTotalCostValue: Prisma.Decimal;
    let movementUnitCost: Prisma.Decimal;
    let signedMovementQty: Prisma.Decimal;

    if (isStockIn) {
      // ----------------------------------------------------
      // STOCK-IN: Calculate Weighted Average Cost (WAC)
      // ----------------------------------------------------
      const inUnitCost =
        params.unitCost !== undefined
          ? new Prisma.Decimal(params.unitCost)
          : new Prisma.Decimal(variant.cost_price || 0);

      newQty = oldQty.plus(absQty);
      signedMovementQty = absQty;
      movementUnitCost = inUnitCost;

      if (oldQty.lessThanOrEqualTo(0)) {
        // If prior quantity was 0 (or negative), new WAC is simply the new batch cost
        newWac = inUnitCost.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        newTotalCostValue = newQty.times(newWac).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      } else {
        // WAC formula: (old_value + in_qty * unit_cost) / (old_qty + in_qty)
        const addedValue = absQty.times(inUnitCost);
        const numerator = oldValue.plus(addedValue);
        newWac = numerator.dividedBy(newQty).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        newTotalCostValue = newQty.times(newWac).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      }

      // Ensure product is active and visible in this branch
      await this.productBranchService.ensureProductInBranch(
        tx,
        params.businessId,
        variant.product_id,
        params.branchId,
      );
    } else {
      // ----------------------------------------------------
      // STOCK-OUT: Check sufficiency, WAC stays unchanged
      // ----------------------------------------------------
      const available = oldQty.minus(new Prisma.Decimal(balance.allocated_quantity));

      if (!params.allowNegativeStock && available.lessThan(absQty)) {
        throw new BadRequestException({
          code: 'INSUFFICIENT_STOCK',
          message: `Insufficient stock for SKU "${variant.sku}". Available: ${available.toString()}, requested: ${absQty.toString()}`,
          available: available.toNumber(),
        });
      }

      newQty = oldQty.minus(absQty);
      signedMovementQty = absQty.negated();
      newWac = oldWac;
      movementUnitCost = oldWac;

      newTotalCostValue = newQty.greaterThan(0)
        ? newQty.times(newWac).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
        : new Prisma.Decimal(0);

      // Check low stock trigger
      const newAvailable = newQty.minus(new Prisma.Decimal(balance.allocated_quantity));
      if (newAvailable.lessThanOrEqualTo(variant.reorder_level)) {
        await this.createLowStockNotificationIfMissing(
          tx,
          params.businessId,
          params.branchId,
          variant.sku,
          newAvailable.toNumber(),
          variant.reorder_level,
        );
      }
    }

    // 4. Update StockBalance
    const updatedBalance = await tx.stockBalance.update({
      where: { id: balance.id },
      data: {
        quantity: newQty,
        avg_cost_price: newWac,
        total_cost_value: newTotalCostValue,
        last_movement_at: new Date(),
      },
    });

    // 5. Write StockMovement log
    const movement = await tx.stockMovement.create({
      data: {
        business_id: params.businessId,
        branch_id: params.branchId,
        product_variant_id: params.variantId,
        movement_type: params.movementType,
        quantity: signedMovementQty,
        unit_cost: movementUnitCost,
        new_wac: newWac,
        reference_type: params.referenceType,
        reference_id: params.referenceId,
        batch_no: params.batchNo || null,
        remarks: params.remarks || null,
        created_by: params.createdBy,
      },
    });

    return {
      balance: updatedBalance,
      movement,
      newWac,
    };
  }

  private async createLowStockNotificationIfMissing(
    tx: Prisma.TransactionClient,
    businessId: string,
    branchId: string,
    sku: string,
    available: number,
    reorderLevel: number,
  ) {
    const existing = await tx.notification.findFirst({
      where: {
        business_id: businessId,
        branch_id: branchId,
        type: 'LOW_STOCK',
        is_read: false,
        message: { contains: sku },
      },
    });

    if (!existing) {
      await tx.notification.create({
        data: {
          business_id: businessId,
          branch_id: branchId,
          title: `Low Stock Alert: ${sku}`,
          message: `Stock for variant ${sku} dropped to ${available} units (reorder level is ${reorderLevel}).`,
          type: 'LOW_STOCK',
          is_read: false,
        },
      });
    }
  }

  // ============================================================================
  // READ-SIDE QUERIES & REPORTS
  // ============================================================================

  async listCurrentStock(
    businessId: string,
    branchId: string,
    query: CurrentStockQueryDto,
  ) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Number(query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.StockBalanceWhereInput = {
      business_id: businessId,
      branch_id: branchId,
      variant: {
        deleted_at: null,
        ...(query.brandId && { product: { brand_id: query.brandId } }),
        ...(query.categoryId && { product: { category_id: query.categoryId } }),
        ...(query.seasonId && { product: { season_id: query.seasonId } }),
        ...(query.gender && { product: { gender: query.gender } }),
        ...(query.search && {
          OR: [
            { sku: { contains: query.search, mode: 'insensitive' } },
            { barcode: { contains: query.search, mode: 'insensitive' } },
            { product: { name: { contains: query.search, mode: 'insensitive' } } },
          ],
        }),
      },
      ...(query.zeroStockOnly && { quantity: { equals: 0 } }),
    };

    const [total, balances] = await Promise.all([
      this.prisma.stockBalance.count({ where }),
      this.prisma.stockBalance.findMany({
        where,
        skip,
        take: limit,
        include: {
          variant: {
            include: {
              product: {
                include: {
                  brand: true,
                  category: true,
                  unit: true,
                },
              },
              size: true,
              color: true,
            },
          },
        },
        orderBy: { updated_at: 'desc' },
      }),
    ]);

    let filtered = balances.map((b) => {
      const qty = Number(b.quantity);
      const allocated = Number(b.allocated_quantity);
      const available = qty - allocated;
      return {
        id: b.id,
        variantId: b.product_variant_id,
        sku: b.variant.sku,
        barcode: b.variant.barcode,
        productName: b.variant.product.name,
        productCode: b.variant.product.code,
        brand: b.variant.product.brand?.name || null,
        category: b.variant.product.category.name,
        size: b.variant.size?.name || null,
        color: b.variant.color?.name || null,
        reorderLevel: b.variant.reorder_level,
        quantity: qty,
        allocatedQuantity: allocated,
        availableQuantity: available,
        avgCostPrice: Number(b.avg_cost_price),
        totalCostValue: Number(b.total_cost_value),
        lastMovementAt: b.last_movement_at,
      };
    });

    if (query.lowStockOnly) {
      filtered = filtered.filter((i) => i.availableQuantity <= i.reorderLevel);
    }

    return {
      data: filtered,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getAllBranchesSummary(businessId: string) {
    const balances = await this.prisma.stockBalance.findMany({
      where: {
        business_id: businessId,
        variant: { deleted_at: null },
      },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        variant: {
          include: {
            product: {
              include: {
                brand: true,
                category: true,
              },
            },
            size: true,
            color: true,
          },
        },
      },
    });

    // Group by variant
    const variantMap = new Map<string, any>();
    const brandMap = new Map<string, { totalQty: number; totalValue: number }>();
    const categoryMap = new Map<string, { totalQty: number; totalValue: number }>();

    let totalSystemQty = 0;
    let totalSystemValue = 0;

    for (const b of balances) {
      const qty = Number(b.quantity);
      const val = Number(b.total_cost_value);
      totalSystemQty += qty;
      totalSystemValue += val;

      // Group by variant
      if (!variantMap.has(b.product_variant_id)) {
        variantMap.set(b.product_variant_id, {
          variantId: b.variant.id,
          sku: b.variant.sku,
          barcode: b.variant.barcode,
          productName: b.variant.product.name,
          brand: b.variant.product.brand?.name || 'Unbranded',
          category: b.variant.product.category.name,
          size: b.variant.size?.name || null,
          color: b.variant.color?.name || null,
          totalQuantity: 0,
          totalCostValue: 0,
          branches: [],
        });
      }
      const vEntry = variantMap.get(b.product_variant_id);
      vEntry.totalQuantity += qty;
      vEntry.totalCostValue += val;
      vEntry.branches.push({
        branchId: b.branch.id,
        branchName: b.branch.name,
        branchCode: b.branch.code,
        quantity: qty,
        avgCostPrice: Number(b.avg_cost_price),
        totalCostValue: val,
      });

      // Group by brand
      const brandName = b.variant.product.brand?.name || 'Unbranded';
      const bBrand = brandMap.get(brandName) || { totalQty: 0, totalValue: 0 };
      bBrand.totalQty += qty;
      bBrand.totalValue += val;
      brandMap.set(brandName, bBrand);

      // Group by category
      const catName = b.variant.product.category.name;
      const bCat = categoryMap.get(catName) || { totalQty: 0, totalValue: 0 };
      bCat.totalQty += qty;
      bCat.totalValue += val;
      categoryMap.set(catName, bCat);
    }

    return {
      summary: {
        totalQuantity: totalSystemQty,
        totalCostValue: Math.round(totalSystemValue * 100) / 100,
        totalVariants: variantMap.size,
      },
      byBrand: Array.from(brandMap.entries()).map(([brand, data]) => ({
        brand,
        ...data,
      })),
      byCategory: Array.from(categoryMap.entries()).map(([category, data]) => ({
        category,
        ...data,
      })),
      variants: Array.from(variantMap.values()),
    };
  }

  async getMovementsHistory(
    businessId: string,
    branchId: string,
    query: StockMovementQueryDto,
  ) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Number(query.limit || 50));
    const skip = (page - 1) * limit;

    const where: Prisma.StockMovementWhereInput = {
      business_id: businessId,
      branch_id: branchId,
      ...(query.variantId && { product_variant_id: query.variantId }),
      ...(query.movementType && { movement_type: query.movementType }),
      ...(query.referenceType && { reference_type: query.referenceType }),
      ...(query.startDate || query.endDate
        ? {
            created_at: {
              ...(query.startDate && { gte: new Date(query.startDate) }),
              ...(query.endDate && { lte: new Date(query.endDate) }),
            },
          }
        : {}),
    };

    const [total, movements] = await Promise.all([
      this.prisma.stockMovement.count({ where }),
      this.prisma.stockMovement.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          variant: {
            select: {
              sku: true,
              barcode: true,
              product: { select: { name: true } },
            },
          },
        },
      }),
    ]);

    return {
      data: movements.map((m) => ({
        id: m.id,
        variantId: m.product_variant_id,
        sku: m.variant.sku,
        barcode: m.variant.barcode,
        productName: m.variant.product.name,
        movementType: m.movement_type,
        quantity: Number(m.quantity),
        unitCost: Number(m.unit_cost),
        newWac: Number(m.new_wac),
        referenceType: m.reference_type,
        referenceId: m.reference_id,
        batchNo: m.batch_no,
        remarks: m.remarks,
        createdAt: m.created_at,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getLowStockReport(businessId: string, branchId: string) {
    const balances = await this.prisma.stockBalance.findMany({
      where: {
        business_id: businessId,
        branch_id: branchId,
        variant: { deleted_at: null },
      },
      include: {
        variant: {
          include: {
            product: { include: { brand: true, category: true } },
            size: true,
            color: true,
          },
        },
      },
      orderBy: { quantity: 'asc' },
    });

    const lowStockItems = balances
      .filter((b) => {
        const available = Number(b.quantity) - Number(b.allocated_quantity);
        return available <= b.variant.reorder_level;
      })
      .map((b) => {
        const available = Number(b.quantity) - Number(b.allocated_quantity);
        return {
          variantId: b.product_variant_id,
          sku: b.variant.sku,
          barcode: b.variant.barcode,
          productName: b.variant.product.name,
          category: b.variant.product.category.name,
          brand: b.variant.product.brand?.name || null,
          size: b.variant.size?.name || null,
          color: b.variant.color?.name || null,
          currentStock: Number(b.quantity),
          allocated: Number(b.allocated_quantity),
          available,
          reorderLevel: b.variant.reorder_level,
          shortage: Math.max(0, b.variant.reorder_level - available),
          unitCost: Number(b.avg_cost_price),
        };
      });

    return {
      branchId,
      totalLowStockVariants: lowStockItems.length,
      items: lowStockItems,
    };
  }

  async getStockValuation(businessId: string, branchId: string) {
    const balances = await this.prisma.stockBalance.findMany({
      where: {
        business_id: businessId,
        branch_id: branchId,
        variant: { deleted_at: null },
      },
      include: {
        variant: {
          include: {
            product: { include: { category: true, brand: true } },
          },
        },
      },
    });

    let totalQuantity = 0;
    let totalCostValue = 0;
    const categoryBreakdown = new Map<string, { quantity: number; costValue: number }>();
    const brandBreakdown = new Map<string, { quantity: number; costValue: number }>();

    for (const b of balances) {
      const q = Number(b.quantity);
      const v = Number(b.total_cost_value);
      totalQuantity += q;
      totalCostValue += v;

      const cat = b.variant.product.category.name;
      const cData = categoryBreakdown.get(cat) || { quantity: 0, costValue: 0 };
      cData.quantity += q;
      cData.costValue += v;
      categoryBreakdown.set(cat, cData);

      const brand = b.variant.product.brand?.name || 'Unbranded';
      const bData = brandBreakdown.get(brand) || { quantity: 0, costValue: 0 };
      bData.quantity += q;
      bData.costValue += v;
      brandBreakdown.set(brand, bData);
    }

    return {
      branchId,
      totalQuantity,
      totalCostValue: Math.round(totalCostValue * 100) / 100,
      totalItems: balances.length,
      byCategory: Array.from(categoryBreakdown.entries()).map(([name, data]) => ({
        category: name,
        quantity: data.quantity,
        costValue: Math.round(data.costValue * 100) / 100,
      })),
      byBrand: Array.from(brandBreakdown.entries()).map(([name, data]) => ({
        brand: name,
        quantity: data.quantity,
        costValue: Math.round(data.costValue * 100) / 100,
      })),
    };
  }

  /**
   * Enter opening stock for a variant in a branch.
   * Allowed ONLY if no prior movements exist for that variant+branch.
   */
  async enterOpeningStock(
    businessId: string,
    branchId: string,
    userId: string,
    dto: OpeningStockDto,
  ) {
    const existingCount = await this.prisma.stockMovement.count({
      where: {
        business_id: businessId,
        branch_id: branchId,
        product_variant_id: dto.variantId,
      },
    });

    if (existingCount > 0) {
      throw new BadRequestException(
        'Stock movements already exist for this variant in this branch. Please use Stock Adjustments instead.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const result = await this.applyMovement(tx, {
        businessId,
        branchId,
        variantId: dto.variantId,
        movementType: 'OPENING',
        quantity: dto.quantity,
        unitCost: dto.unitCost,
        referenceType: 'OPENING_BALANCE',
        referenceId: dto.variantId,
        createdBy: userId,
        remarks: 'Opening stock entry',
      });

      return {
        message: 'Opening stock applied successfully.',
        balance: result.balance,
        movement: result.movement,
      };
    });
  }

  /**
   * Consistency Tool: compares StockBalance.quantity with sum of StockMovement
   * and with ProductUnit IN_STOCK counts for tracked items.
   * Does NOT auto-fix.
   */
  async checkConsistency(businessId: string, branchId?: string) {
    const balances = await this.prisma.stockBalance.findMany({
      where: {
        business_id: businessId,
        ...(branchId ? { branch_id: branchId } : {}),
      },
      include: {
        variant: {
          include: {
            product: { select: { name: true, track_individually: true } },
          },
        },
      },
    });

    const mismatches: Array<{
      branchId: string;
      variantId: string;
      sku: string;
      productName: string;
      balanceQuantity: number;
      movementSum: number;
      unitCount?: number;
      quantityMismatch: boolean;
      unitMismatch: boolean;
    }> = [];

    for (const b of balances) {
      const movementAggregate = await this.prisma.stockMovement.aggregate({
        where: {
          business_id: businessId,
          branch_id: b.branch_id,
          product_variant_id: b.product_variant_id,
        },
        _sum: { quantity: true },
      });

      const movementSum = Number(movementAggregate._sum.quantity || 0);
      const balanceQty = Number(b.quantity);
      const quantityMismatch = Math.abs(balanceQty - movementSum) > 0.0001;

      let unitMismatch = false;
      let unitCount: number | undefined;

      if (b.variant.product.track_individually) {
        unitCount = await this.prisma.productUnit.count({
          where: {
            business_id: businessId,
            branch_id: b.branch_id,
            product_variant_id: b.product_variant_id,
            status: 'IN_STOCK',
          },
        });
        unitMismatch = unitCount !== balanceQty;
      }

      if (quantityMismatch || unitMismatch) {
        mismatches.push({
          branchId: b.branch_id,
          variantId: b.product_variant_id,
          sku: b.variant.sku,
          productName: b.variant.product.name,
          balanceQuantity: balanceQty,
          movementSum,
          unitCount,
          quantityMismatch,
          unitMismatch,
        });
      }
    }

    return {
      checkedItems: balances.length,
      isConsistent: mismatches.length === 0,
      mismatchesCount: mismatches.length,
      mismatches,
    };
  }
}
