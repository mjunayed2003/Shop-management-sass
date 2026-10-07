import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';

export interface EffectiveLimits {
  isFreeAccess: boolean;
  maxBranches: number;
  maxUsers: number;
  maxProducts: number;
  maxVariants: number;
  maxMonthlyInvoices: number;
  hasApiAccess: boolean;
  hasCustomReports: boolean;
  hasOfflineSync: boolean;
}

export interface LimitUsage {
  branches: number;
  users: number;
  products: number;
  variants: number;
  monthlyInvoices: number;
}

@Injectable()
export class PlanLimitService {
  constructor(private readonly prisma: PrismaService) {}

  async getEffectiveLimits(businessId: string): Promise<EffectiveLimits> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { business_id: businessId },
      include: {
        plan: {
          include: {
            limits: true,
          },
        },
      },
    });

    const now = new Date();
    const activeOverrides = await this.prisma.subscriptionOverride.findMany({
      where: {
        business_id: businessId,
        OR: [
          { valid_until: null },
          { valid_until: { gt: now } },
        ],
      },
    });

    const isFreeAccess =
      Boolean(subscription?.is_free_access) ||
      activeOverrides.some((o) => o.is_free_access);

    if (isFreeAccess) {
      return {
        isFreeAccess: true,
        maxBranches: Infinity,
        maxUsers: Infinity,
        maxProducts: Infinity,
        maxVariants: Infinity,
        maxMonthlyInvoices: Infinity,
        hasApiAccess: true,
        hasCustomReports: true,
        hasOfflineSync: true,
      };
    }

    const planLimits = subscription?.plan?.limits;

    // Highest non-null override takes precedence
    let maxBranches = planLimits?.max_branches ?? 1;
    let maxUsers = planLimits?.max_users ?? 3;
    let maxProducts = planLimits?.max_products ?? 500;
    let maxVariants = planLimits?.max_variants ?? 1500;
    const maxMonthlyInvoices = planLimits?.max_monthly_invoices ?? 1000;
    const hasApiAccess = planLimits?.has_api_access ?? false;
    const hasCustomReports = planLimits?.has_custom_reports ?? false;
    const hasOfflineSync = planLimits?.has_offline_sync ?? true;

    for (const ov of activeOverrides) {
      if (ov.override_max_branches !== null && ov.override_max_branches !== undefined) {
        maxBranches = Math.max(maxBranches, ov.override_max_branches);
      }
      if (ov.override_max_users !== null && ov.override_max_users !== undefined) {
        maxUsers = Math.max(maxUsers, ov.override_max_users);
      }
      if (ov.override_max_products !== null && ov.override_max_products !== undefined) {
        maxProducts = Math.max(maxProducts, ov.override_max_products);
      }
      if (ov.override_max_variants !== null && ov.override_max_variants !== undefined) {
        maxVariants = Math.max(maxVariants, ov.override_max_variants);
      }
    }

    return {
      isFreeAccess: false,
      maxBranches,
      maxUsers,
      maxProducts,
      maxVariants,
      maxMonthlyInvoices,
      hasApiAccess,
      hasCustomReports,
      hasOfflineSync,
    };
  }

  async checkBranchLimit(businessId: string): Promise<void> {
    const limits = await this.getEffectiveLimits(businessId);
    if (limits.isFreeAccess || limits.maxBranches === Infinity) return;

    const branchCount = await this.prisma.branch.count({
      where: {
        business_id: businessId,
        is_active: true,
        deleted_at: null,
      },
    });

    if (branchCount >= limits.maxBranches) {
      throw new ForbiddenException({
        code: 'PLAN_LIMIT_REACHED',
        limit: 'max_branches',
        current: branchCount,
        max: limits.maxBranches,
        message: `Branch limit reached (${branchCount}/${limits.maxBranches}). Upgrade your plan to add more branches.`,
      });
    }
  }

  async checkUserLimit(businessId: string): Promise<void> {
    const limits = await this.getEffectiveLimits(businessId);
    if (limits.isFreeAccess || limits.maxUsers === Infinity) return;

    const userCount = await this.prisma.user.count({
      where: {
        business_id: businessId,
        is_active: true,
        deleted_at: null,
      },
    });

    if (userCount >= limits.maxUsers) {
      throw new ForbiddenException({
        code: 'PLAN_LIMIT_REACHED',
        limit: 'max_users',
        current: userCount,
        max: limits.maxUsers,
        message: `User limit reached (${userCount}/${limits.maxUsers}). Upgrade your plan to add more users.`,
      });
    }
  }

  async checkProductLimit(businessId: string): Promise<void> {
    const limits = await this.getEffectiveLimits(businessId);
    if (limits.isFreeAccess || limits.maxProducts === Infinity) return;

    const productCount = await this.prisma.product.count({
      where: {
        business_id: businessId,
        deleted_at: null,
      },
    });

    if (productCount >= limits.maxProducts) {
      throw new ForbiddenException({
        code: 'PLAN_LIMIT_REACHED',
        limit: 'max_products',
        current: productCount,
        max: limits.maxProducts,
        message: `Product limit reached (${productCount}/${limits.maxProducts}). Upgrade your plan to add more products.`,
      });
    }
  }

  async checkVariantLimit(businessId: string, additionalCount = 1): Promise<void> {
    const limits = await this.getEffectiveLimits(businessId);
    if (limits.isFreeAccess || limits.maxVariants === Infinity) return;

    const variantCount = await this.prisma.productVariant.count({
      where: {
        product: {
          business_id: businessId,
          deleted_at: null,
        },
      },
    });

    if (variantCount + additionalCount > limits.maxVariants) {
      throw new ForbiddenException({
        code: 'PLAN_LIMIT_REACHED',
        limit: 'max_variants',
        current: variantCount,
        max: limits.maxVariants,
        message: `Product variant limit reached (${variantCount}/${limits.maxVariants}). Upgrade your plan to add more variants.`,
      });
    }
  }

  async checkMonthlyInvoiceLimit(businessId: string): Promise<void> {
    const limits = await this.getEffectiveLimits(businessId);
    if (limits.isFreeAccess || limits.maxMonthlyInvoices === Infinity) return;

    const subscription = await this.prisma.subscription.findUnique({
      where: { business_id: businessId },
    });

    const now = new Date();
    const periodStart = subscription?.current_period_start || new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = subscription?.current_period_end || new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const saleCount = await this.prisma.sale.count({
      where: {
        business_id: businessId,
        created_at: {
          gte: periodStart,
          lte: periodEnd,
        },
      },
    });

    if (saleCount >= limits.maxMonthlyInvoices) {
      throw new ForbiddenException({
        code: 'PLAN_LIMIT_REACHED',
        limit: 'max_monthly_invoices',
        current: saleCount,
        max: limits.maxMonthlyInvoices,
        message: `Monthly invoice limit reached (${saleCount}/${limits.maxMonthlyInvoices}). Upgrade your plan to issue more sales this month.`,
      });
    }
  }

  async checkFeature(
    businessId: string,
    feature: 'has_offline_sync' | 'has_custom_reports' | 'has_api_access',
  ): Promise<void> {
    const limits = await this.getEffectiveLimits(businessId);
    if (limits.isFreeAccess) return;

    let allowed = false;
    if (feature === 'has_offline_sync') allowed = limits.hasOfflineSync;
    if (feature === 'has_custom_reports') allowed = limits.hasCustomReports;
    if (feature === 'has_api_access') allowed = limits.hasApiAccess;

    if (!allowed) {
      throw new ForbiddenException({
        code: 'PLAN_LIMIT_REACHED',
        limit: feature,
        message: `Feature "${feature}" is not included in your current subscription plan. Upgrade your plan to unlock this feature.`,
      });
    }
  }

  async getUsageAndLimits(businessId: string): Promise<{ limits: EffectiveLimits; usage: LimitUsage }> {
    const limits = await this.getEffectiveLimits(businessId);

    const subscription = await this.prisma.subscription.findUnique({
      where: { business_id: businessId },
    });

    const now = new Date();
    const periodStart = subscription?.current_period_start || new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = subscription?.current_period_end || new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const [branchCount, userCount, productCount, variantCount, saleCount] = await Promise.all([
      this.prisma.branch.count({
        where: { business_id: businessId, is_active: true, deleted_at: null },
      }),
      this.prisma.user.count({
        where: { business_id: businessId, is_active: true, deleted_at: null },
      }),
      this.prisma.product.count({
        where: { business_id: businessId, deleted_at: null },
      }),
      this.prisma.productVariant.count({
        where: { product: { business_id: businessId, deleted_at: null } },
      }),
      this.prisma.sale.count({
        where: { business_id: businessId, created_at: { gte: periodStart, lte: periodEnd } },
      }),
    ]);

    return {
      limits,
      usage: {
        branches: branchCount,
        users: userCount,
        products: productCount,
        variants: variantCount,
        monthlyInvoices: saleCount,
      },
    };
  }
}
