import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { Prisma } from '../../../generated/prisma/client.js';

@Injectable()
export class ProductBranchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reusable helper function to ensure a product is assigned and active in a branch.
   * Can be called inside an ongoing Prisma transaction (e.g. from Phase 3 stock transfer or Phase 4 sales).
   */
  async ensureProductInBranch(
    tx: Prisma.TransactionClient,
    businessId: string,
    productId: string,
    branchId: string,
  ) {
    // 1. Upsert ProductBranch row
    const productBranch = await tx.productBranch.upsert({
      where: {
        product_id_branch_id: {
          product_id: productId,
          branch_id: branchId,
        },
      },
      create: {
        business_id: businessId,
        product_id: productId,
        branch_id: branchId,
        is_active: true,
      },
      update: {
        is_active: true,
      },
    });

    // 2. Ensure StockBalance records exist for each variant of this product in the branch
    const variants = await tx.productVariant.findMany({
      where: {
        product_id: productId,
        deleted_at: null,
      },
      select: { id: true },
    });

    for (const v of variants) {
      await tx.stockBalance.upsert({
        where: {
          business_id_branch_id_product_variant_id: {
            business_id: businessId,
            branch_id: branchId,
            product_variant_id: v.id,
          },
        },
        create: {
          business_id: businessId,
          branch_id: branchId,
          product_variant_id: v.id,
          quantity: 0,
          allocated_quantity: 0,
          avg_cost_price: 0,
          total_cost_value: 0,
        },
        update: {},
      });
    }

    return productBranch;
  }

  async activateProductInBranch(businessId: string, productId: string, branchId: string) {
    // Verify product exists
    const product = await this.prisma.product.findFirst({
      where: { id: productId, business_id: businessId, deleted_at: null },
    });
    if (!product) {
      throw new NotFoundException(`Product with ID "${productId}" not found in your business.`);
    }

    // Verify branch exists and is active
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, business_id: businessId, deleted_at: null, is_active: true },
    });
    if (!branch) {
      throw new NotFoundException(`Active branch with ID "${branchId}" not found in your business.`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      return this.ensureProductInBranch(tx, businessId, productId, branchId);
    });

    return {
      message: `Product "${product.name}" successfully activated in branch "${branch.name}".`,
      productBranch: result,
    };
  }

  async deactivateProductInBranch(
    businessId: string,
    productId: string,
    branchId: string,
    force = false,
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, business_id: businessId, deleted_at: null },
    });
    if (!product) {
      throw new NotFoundException(`Product with ID "${productId}" not found.`);
    }

    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, business_id: businessId, deleted_at: null },
    });
    if (!branch) {
      throw new NotFoundException(`Branch with ID "${branchId}" not found.`);
    }

    const productBranch = await this.prisma.productBranch.findUnique({
      where: {
        product_id_branch_id: {
          product_id: productId,
          branch_id: branchId,
        },
      },
    });

    if (!productBranch || !productBranch.is_active) {
      return {
        message: `Product "${product.name}" is already inactive in branch "${branch.name}".`,
        productBranch,
      };
    }

    // Critical Business Rule: Block deactivation if that branch still has stock (> 0) unless force=true
    const stockAggregate = await this.prisma.stockBalance.aggregate({
      where: {
        business_id: businessId,
        branch_id: branchId,
        variant: {
          product_id: productId,
          deleted_at: null,
        },
      },
      _sum: { quantity: true },
    });

    const activeStock = Number(stockAggregate._sum.quantity || 0);

    if (activeStock > 0 && !force) {
      throw new BadRequestException(
        `Cannot deactivate product "${product.name}" in branch "${branch.name}": there are still ${activeStock} active unit(s) in stock. Set force=true to override and deactivate anyway.`,
      );
    }

    const updated = await this.prisma.productBranch.update({
      where: {
        product_id_branch_id: {
          product_id: productId,
          branch_id: branchId,
        },
      },
      data: { is_active: false },
    });

    return {
      message: `Product "${product.name}" deactivated in branch "${branch.name}".`,
      productBranch: updated,
    };
  }
}
