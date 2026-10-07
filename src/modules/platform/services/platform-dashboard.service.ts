import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { PlatformInvoiceStatus, SyncStatus } from '../../../generated/prisma/client.js';

@Injectable()
export class PlatformDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getPlatformMetrics() {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [
      businessesByStatus,
      subscriptionsByStatus,
      trialsExpiringSoon,
      overdueInvoices,
      revenueCollected,
      smsVolume,
      syncErrors,
    ] = await Promise.all([
      this.prisma.business.groupBy({
        by: ['status'],
        where: { deleted_at: null },
        _count: { id: true },
      }),
      this.prisma.subscription.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      this.prisma.subscription.count({
        where: {
          status: 'TRIAL',
          trial_ends_at: { lte: sevenDaysFromNow, gte: now },
        },
      }),
      this.prisma.subscriptionInvoice.aggregate({
        where: { status: PlatformInvoiceStatus.OVERDUE },
        _count: { id: true },
        _sum: { net_amount: true },
      }),
      this.prisma.platformPayment.aggregate({
        where: { status: PlatformInvoiceStatus.PAID },
        _sum: { amount: true },
      }),
      this.prisma.smsLog.count(),
      this.prisma.syncQueue.count({
        where: { status: { in: [SyncStatus.CONFLICT, SyncStatus.FAILED] } },
      }),
    ]);

    return {
      businesses: businessesByStatus.reduce((acc, b) => ({ ...acc, [b.status]: b._count.id }), {}),
      subscriptions: subscriptionsByStatus.reduce((acc, s) => ({ ...acc, [s.status]: s._count.id }), {}),
      trialsExpiringSoon,
      overdue: {
        count: overdueInvoices._count.id,
        amount: overdueInvoices._sum.net_amount ? Number(overdueInvoices._sum.net_amount) : 0,
      },
      revenueCollected: revenueCollected._sum.amount ? Number(revenueCollected._sum.amount) : 0,
      smsVolume,
      syncErrors,
    };
  }

  async getGlobalAuditLogs(query: {
    page?: number;
    limit?: number;
    businessId?: string;
    action?: string;
    entityTable?: string;
  }) {
    const page = query.page || 1;
    const limit = query.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.businessId) where.business_id = query.businessId;
    if (query.action) where.action = query.action;
    if (query.entityTable) where.entity_table = query.entityTable;

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          business: { select: { id: true, name: true, slug: true } },
          user: { select: { id: true, first_name: true, last_name: true, email: true } },
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
