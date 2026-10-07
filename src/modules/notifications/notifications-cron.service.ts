import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationService } from './notifications.service.js';
import { NotificationType } from '../../generated/prisma/client.js';

@Injectable()
export class NotificationCronService {
  private readonly logger = new Logger(NotificationCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Scans registers open for more than 24 hours and notifies branch staff/manager.
   */
  async checkUnclosedRegisterSessions(): Promise<number> {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const openSessions = await this.prisma.registerSession.findMany({
      where: {
        status: 'OPEN',
        opened_at: { lte: twentyFourHoursAgo },
      },
      include: {
        user: true,
        branch: true,
      },
    });

    for (const session of openSessions) {
      await this.notificationService.create({
        businessId: session.business_id,
        branchId: session.branch_id,
        type: NotificationType.SYSTEM_ALERT,
        title: 'Unclosed Register Shift Reminder',
        message: `Register session for cashier "${session.user.first_name}" has been open for more than 24 hours. Please perform register shift close (Z Report).`,
      });
    }

    return openSessions.length;
  }

  /**
   * Generates low-stock digest summary per branch.
   */
  async generateLowStockDigests(): Promise<number> {
    const balances = await this.prisma.stockBalance.findMany({
      where: {
        variant: {
          reorder_level: { gt: 0 },
        },
      },
      include: {
        variant: {
          select: { sku: true, reorder_level: true, product: { select: { name: true } } },
        },
      },
    });

    const lowStockByBranch = new Map<string, { businessId: string; branchId: string; items: string[] }>();

    for (const b of balances) {
      const avail = Number(b.quantity) - Number(b.allocated_quantity);
      if (avail <= b.variant.reorder_level) {
        const key = `${b.business_id}:${b.branch_id}`;
        if (!lowStockByBranch.has(key)) {
          lowStockByBranch.set(key, { businessId: b.business_id, branchId: b.branch_id, items: [] });
        }
        lowStockByBranch.get(key)!.items.push(`${b.variant.sku} (Available: ${avail})`);
      }
    }

    let createdCount = 0;
    for (const [, entry] of lowStockByBranch) {
      if (entry.items.length > 0) {
        await this.notificationService.create({
          businessId: entry.businessId,
          branchId: entry.branchId,
          type: NotificationType.LOW_STOCK,
          title: 'Daily Low Stock Digest',
          message: `${entry.items.length} item(s) are at or below reorder level: ${entry.items.slice(0, 3).join(', ')}${entry.items.length > 3 ? '...' : ''}`,
        });
        createdCount++;
      }
    }

    return createdCount;
  }

  /**
   * Warns businesses when trials or subscriptions are ending soon (3 days, 1 day).
   */
  async checkSubscriptionExpiryReminders(): Promise<number> {
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const subs = await this.prisma.subscription.findMany({
      where: {
        status: { in: ['TRIAL', 'ACTIVE'] },
        OR: [
          { trial_ends_at: { lte: threeDaysFromNow, gte: now } },
          { current_period_end: { lte: threeDaysFromNow, gte: now } },
        ],
      },
    });

    let reminders = 0;
    for (const s of subs) {
      const targetDate = s.status === 'TRIAL' ? s.trial_ends_at : s.current_period_end;
      const daysLeft = Math.ceil((targetDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

      await this.notificationService.create({
        businessId: s.business_id,
        type: NotificationType.SUBSCRIPTION_DUE,
        title: 'Subscription Expiry Notice',
        message: `Your subscription ${s.status === 'TRIAL' ? 'trial' : 'period'} expires in ${daysLeft} day(s). Renew now to prevent service interruption.`,
      });
      reminders++;
    }

    return reminders;
  }

  /**
   * Cleans up expired IdempotencyKey records and expired UserSession records.
   */
  async cleanupExpiredRecords(): Promise<{ cleanedIdempotency: number; cleanedSessions: number }> {
    const now = new Date();
    const [idemRes, sessionRes] = await Promise.all([
      this.prisma.idempotencyKey.deleteMany({
        where: { expires_at: { lt: now } },
      }),
      this.prisma.userSession.deleteMany({
        where: { expires_at: { lt: now } },
      }),
    ]);

    return {
      cleanedIdempotency: idemRes.count,
      cleanedSessions: sessionRes.count,
    };
  }

  /**
   * Flags sync queue items stuck in PENDING for more than 1 hour.
   */
  async checkStaleSyncQueueAlerts(): Promise<number> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const staleItems = await this.prisma.syncQueue.findMany({
      where: {
        status: 'PENDING',
        created_at: { lte: oneHourAgo },
      },
    });

    if (staleItems.length > 0) {
      // Group by business and branch
      const branchMap = new Map<string, { businessId: string; branchId: string; count: number }>();
      for (const item of staleItems) {
        const key = `${item.business_id}:${item.branch_id}`;
        if (!branchMap.has(key)) {
          branchMap.set(key, { businessId: item.business_id, branchId: item.branch_id, count: 0 });
        }
        branchMap.get(key)!.count++;
      }

      for (const [, entry] of branchMap) {
        await this.notificationService.create({
          businessId: entry.businessId,
          branchId: entry.branchId,
          type: NotificationType.SYSTEM_ALERT,
          title: 'Stale Sync Queue Alert',
          message: `${entry.count} offline operation(s) have been pending processing for more than 1 hour.`,
        });
      }
    }

    return staleItems.length;
  }
}
