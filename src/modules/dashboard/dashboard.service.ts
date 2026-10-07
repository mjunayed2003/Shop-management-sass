import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

interface CacheEntry {
  data: any;
  expiresAt: number;
}

@Injectable()
export class DashboardService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL_MS = 30 * 1000; // 30 seconds

  constructor(private readonly prisma: PrismaService) {}

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  private setCached(key: string, data: any): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
    });
  }

  async getBusinessDashboard(
    businessId: string,
    branchId?: string,
    isAllBranchAdmin = false,
    canViewProfit = false,
  ) {
    const cacheKey = `dash:${businessId}:${isAllBranchAdmin ? 'all' : branchId}:${canViewProfit}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const baseWhereSale: any = {
      business_id: businessId,
      status: { not: 'VOIDED' },
    };
    if (!isAllBranchAdmin && branchId) {
      baseWhereSale.branch_id = branchId;
    }

    // 1. Sales aggregates
    const [salesToday, salesWeek, salesMonth] = await Promise.all([
      this.prisma.sale.aggregate({
        where: { ...baseWhereSale, sale_date: { gte: startOfToday } },
        _sum: { total_amount: true, total_cost: true },
        _count: { id: true },
      }),
      this.prisma.sale.aggregate({
        where: { ...baseWhereSale, sale_date: { gte: startOfWeek } },
        _sum: { total_amount: true, total_cost: true },
        _count: { id: true },
      }),
      this.prisma.sale.aggregate({
        where: { ...baseWhereSale, sale_date: { gte: startOfMonth } },
        _sum: { total_amount: true, total_cost: true },
        _count: { id: true },
      }),
    ]);

    // 2. Expenses today, this week, this month
    const baseWhereExpense: any = { business_id: businessId };
    if (!isAllBranchAdmin && branchId) {
      baseWhereExpense.branch_id = branchId;
    }

    const [expToday, expWeek, expMonth] = await Promise.all([
      this.prisma.expense.aggregate({
        where: { ...baseWhereExpense, expense_date: { gte: startOfToday } },
        _sum: { total_amount: true },
      }),
      this.prisma.expense.aggregate({
        where: { ...baseWhereExpense, expense_date: { gte: startOfWeek } },
        _sum: { total_amount: true },
      }),
      this.prisma.expense.aggregate({
        where: { ...baseWhereExpense, expense_date: { gte: startOfMonth } },
        _sum: { total_amount: true },
      }),
    ]);

    // 3. Receivables & Payables
    const [receivables, payables] = await Promise.all([
      this.prisma.customer.aggregate({
        where: { business_id: businessId, deleted_at: null },
        _sum: { current_due: true },
      }),
      this.prisma.supplier.aggregate({
        where: { business_id: businessId, deleted_at: null },
        _sum: { current_balance: true },
      }),
    ]);

    // 4. Stock value & low stock count
    const stockWhere: any = { business_id: businessId };
    if (!isAllBranchAdmin && branchId) {
      stockWhere.branch_id = branchId;
    }

    const [stockVal, lowStockItems] = await Promise.all([
      this.prisma.stockBalance.aggregate({
        where: stockWhere,
        _sum: { total_cost_value: true },
      }),
      this.prisma.stockBalance.count({
        where: {
          ...stockWhere,
          product_variant: {
            reorder_level: { gt: 0 },
          },
          quantity: { lte: 5 }, // heuristic low stock count
        },
      }),
    ]);

    // 5. 30-Day daily sales trend
    const recentSales = await this.prisma.sale.findMany({
      where: { ...baseWhereSale, sale_date: { gte: thirtyDaysAgo } },
      select: { sale_date: true, total_amount: true },
    });

    const trendMap = new Map<string, number>();
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
      trendMap.set(d.toISOString().slice(0, 10), 0);
    }
    for (const s of recentSales) {
      const dateKey = s.sale_date.toISOString().slice(0, 10);
      trendMap.set(dateKey, (trendMap.get(dateKey) || 0) + Number(s.total_amount));
    }
    const salesTrend = Array.from(trendMap.entries()).map(([date, total]) => ({ date, total }));

    // 6. Top selling products
    const topSaleItems = await this.prisma.saleItem.groupBy({
      by: ['product_variant_id'],
      where: { sale: baseWhereSale },
      _sum: { quantity: true, total_amount: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5,
    });

    const topVariantIds = topSaleItems.map((ti) => ti.product_variant_id);
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: topVariantIds } },
      include: { product: true },
    });

    const topProducts = topSaleItems.map((ti) => {
      const v = variants.find((v) => v.id === ti.product_variant_id);
      return {
        variantId: ti.product_variant_id,
        sku: v?.sku,
        productName: v?.product.name,
        quantitySold: Number(ti._sum.quantity || 0),
        revenue: Number(ti._sum.total_amount || 0),
      };
    });

    // 7. Per branch comparison (for all-branch admin)
    let branchComparison: any[] = [];
    if (isAllBranchAdmin) {
      const branches = await this.prisma.branch.findMany({
        where: { business_id: businessId, deleted_at: null },
      });
      for (const b of branches) {
        const bSales = await this.prisma.sale.aggregate({
          where: { business_id: businessId, branch_id: b.id, status: { not: 'VOIDED' }, sale_date: { gte: startOfMonth } },
          _sum: { total_amount: true },
        });
        branchComparison.push({
          branchId: b.id,
          branchName: b.name,
          monthRevenue: bSales._sum.total_amount ? Number(bSales._sum.total_amount) : 0,
        });
      }
    }

    const todayRev = Number(salesToday._sum.total_amount || 0);
    const weekRev = Number(salesWeek._sum.total_amount || 0);
    const monthRev = Number(salesMonth._sum.total_amount || 0);

    const todayCost = Number(salesToday._sum.total_cost || 0);
    const weekCost = Number(salesWeek._sum.total_cost || 0);
    const monthCost = Number(salesMonth._sum.total_cost || 0);

    const todayExp = Number(expToday._sum.total_amount || 0);
    const weekExp = Number(expWeek._sum.total_amount || 0);
    const monthExp = Number(expMonth._sum.total_amount || 0);

    const result: any = {
      sales: {
        today: { revenue: todayRev, count: salesToday._count.id },
        thisWeek: { revenue: weekRev, count: salesWeek._count.id },
        thisMonth: { revenue: monthRev, count: salesMonth._count.id },
      },
      expenses: {
        today: todayExp,
        thisWeek: weekExp,
        thisMonth: monthExp,
      },
      receivables: Number(receivables._sum.current_due || 0),
      payables: Number(payables._sum.current_balance || 0),
      stockValue: Number(stockVal._sum.total_cost_value || 0),
      lowStockCount: lowStockItems,
      topProducts,
      salesTrend,
      branchComparison,
    };

    // Include cost and profit only if permission allows
    if (canViewProfit) {
      result.profit = {
        today: { gross: todayRev - todayCost, net: todayRev - todayCost - todayExp },
        thisWeek: { gross: weekRev - weekCost, net: weekRev - weekCost - weekExp },
        thisMonth: { gross: monthRev - monthCost, net: monthRev - monthCost - monthExp },
      };
      result.cogs = {
        today: todayCost,
        thisWeek: weekCost,
        thisMonth: monthCost,
      };
    }

    this.setCached(cacheKey, result);
    return result;
  }

  async getCashierDashboard(businessId: string, branchId: string, userId: string) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [activeSession, todaySales] = await Promise.all([
      this.prisma.registerSession.findFirst({
        where: { business_id: businessId, branch_id: branchId, user_id: userId, status: 'OPEN' },
        include: { cash_register: true },
      }),
      this.prisma.sale.aggregate({
        where: {
          business_id: businessId,
          branch_id: branchId,
          created_by: userId,
          sale_date: { gte: startOfToday },
          status: { not: 'VOIDED' },
        },
        _sum: { total_amount: true },
        _count: { id: true },
      }),
    ]);

    return {
      activeSession: activeSession
        ? {
            id: activeSession.id,
            registerName: activeSession.cash_register.name,
            openedAt: activeSession.opened_at,
            openingBalance: activeSession.opening_balance,
          }
        : null,
      today: {
        salesCount: todaySales._count.id,
        salesAmount: todaySales._sum.total_amount ? Number(todaySales._sum.total_amount) : 0,
      },
    };
  }

  async getAuditLogs(
    businessId: string,
    branchId?: string,
    isOwner?: boolean,
    query: { page?: number; limit?: number; userId?: string; action?: any; entityTable?: string } = {},
  ) {
    const page = query.page || 1;
    const limit = query.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = { business_id: businessId };
    if (!isOwner && branchId) {
      where.branch_id = branchId;
    }
    if (query.userId) where.user_id = query.userId;
    if (query.action) where.action = query.action;
    if (query.entityTable) where.entity_table = query.entityTable;

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { id: true, first_name: true, last_name: true, email: true } },
          branch: { select: { id: true, name: true, code: true } },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: logs,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }
}
