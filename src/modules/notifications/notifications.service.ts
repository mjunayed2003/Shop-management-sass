import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationType } from '../../generated/prisma/client.js';
import { Subject, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';

export interface CreateNotificationParams {
  businessId: string;
  branchId?: string | null;
  userId?: string | null;
  type: NotificationType;
  title: string;
  message: string;
}

export interface NotificationBroadcastEvent {
  id: string;
  businessId: string;
  branchId?: string | null;
  userId?: string | null;
  type: NotificationType;
  title: string;
  message: string;
  createdAt: string;
}

@Injectable()
export class NotificationService {
  private readonly notificationStream$ = new Subject<NotificationBroadcastEvent>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a notification with duplicate suppression within a 15-minute window.
   * Broadcasts the event to live SSE listeners.
   */
  async create(params: CreateNotificationParams) {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

    // Duplicate suppression: same business, branch, type, and title unread recently
    const existing = await this.prisma.notification.findFirst({
      where: {
        business_id: params.businessId,
        branch_id: params.branchId ?? null,
        user_id: params.userId ?? null,
        type: params.type,
        title: params.title,
        is_read: false,
        created_at: { gte: fifteenMinutesAgo },
      },
    });

    if (existing) {
      return existing;
    }

    const notification = await this.prisma.notification.create({
      data: {
        business_id: params.businessId,
        branch_id: params.branchId ?? null,
        user_id: params.userId ?? null,
        type: params.type,
        title: params.title,
        message: params.message,
        is_read: false,
      },
    });

    // Broadcast SSE
    this.notificationStream$.next({
      id: notification.id,
      businessId: notification.business_id,
      branchId: notification.branch_id,
      userId: notification.user_id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      createdAt: notification.created_at.toISOString(),
    });

    return notification;
  }

  async listNotifications(
    businessId: string,
    userId: string,
    userBranchIds: string[],
    isOwner: boolean,
    query: { page?: number; limit?: number; unreadOnly?: boolean } = {},
  ) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const whereScope: any = {
      business_id: businessId,
    };

    if (query.unreadOnly) {
      whereScope.is_read = false;
    }

    if (!isOwner) {
      // Must be addressed to user, OR branch-wide for one of user's branches, OR business-wide
      whereScope.OR = [
        { user_id: userId },
        { user_id: null, branch_id: { in: userBranchIds } },
        { user_id: null, branch_id: null },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: whereScope,
        orderBy: [
          { is_read: 'asc' }, // unread first
          { created_at: 'desc' },
        ],
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where: whereScope }),
    ]);

    return {
      data: items,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getUnreadCount(
    businessId: string,
    userId: string,
    userBranchIds: string[],
    isOwner: boolean,
  ): Promise<{ unreadCount: number }> {
    const whereScope: any = {
      business_id: businessId,
      is_read: false,
    };

    if (!isOwner) {
      whereScope.OR = [
        { user_id: userId },
        { user_id: null, branch_id: { in: userBranchIds } },
        { user_id: null, branch_id: null },
      ];
    }

    const count = await this.prisma.notification.count({ where: whereScope });
    return { unreadCount: count };
  }

  async markAsRead(businessId: string, userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, business_id: businessId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found.');
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { is_read: true },
    });
  }

  async markAllAsRead(
    businessId: string,
    userId: string,
    userBranchIds: string[],
    isOwner: boolean,
  ) {
    const whereScope: any = {
      business_id: businessId,
      is_read: false,
    };

    if (!isOwner) {
      whereScope.OR = [
        { user_id: userId },
        { user_id: null, branch_id: { in: userBranchIds } },
        { user_id: null, branch_id: null },
      ];
    }

    const result = await this.prisma.notification.updateMany({
      where: whereScope,
      data: { is_read: true },
    });

    return { markedCount: result.count };
  }

  /**
   * Returns an Observable SSE event stream filtered to the user's business and accessible branches.
   */
  getEventStream(
    businessId: string,
    userId: string,
    userBranchIds: string[],
    isOwner: boolean,
  ): Observable<{ data: NotificationBroadcastEvent }> {
    return this.notificationStream$.asObservable().pipe(
      filter((evt) => {
        if (evt.businessId !== businessId) return false;
        if (isOwner) return true;
        if (evt.userId === userId) return true;
        if (!evt.userId && evt.branchId && userBranchIds.includes(evt.branchId)) return true;
        if (!evt.userId && !evt.branchId) return true;
        return false;
      }),
      map((evt) => ({ data: evt })),
    );
  }
}
