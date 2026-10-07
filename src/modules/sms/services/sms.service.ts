import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  SmsPurpose,
  SmsStatus,
  NotificationType,
} from '../../../generated/prisma/client.js';
import { SmsTemplateService } from './sms-template.service.js';
import { NotificationService } from '../../notifications/notifications.service.js';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly templateService: SmsTemplateService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Checks whether the business has reached its monthly SMS quota.
   */
  async checkQuota(businessId: string): Promise<{ allowed: boolean; used: number; quota: number }> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let quota = 500;
    const quotaSetting = await this.prisma.systemSetting.findUnique({
      where: { key: `sms_quota:${businessId}` },
    });
    if (quotaSetting && !isNaN(parseInt(quotaSetting.value, 10))) {
      quota = parseInt(quotaSetting.value, 10);
    }

    const usedCount = await this.prisma.smsLog.count({
      where: {
        business_id: businessId,
        status: { in: [SmsStatus.SENT, SmsStatus.DELIVERED, SmsStatus.PENDING] },
        created_at: { gte: monthStart },
      },
    });

    return {
      allowed: usedCount < quota,
      used: usedCount,
      quota,
    };
  }

  /**
   * Checks if phone number is on the opt-out list.
   */
  async isOptedOut(businessId: string, phone: string): Promise<boolean> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: `sms_opt_out:${businessId}` },
    });
    if (!setting) return false;

    try {
      const list = JSON.parse(setting.value);
      return Array.isArray(list) && list.includes(phone);
    } catch {
      return false;
    }
  }

  /**
   * Queues an SMS message in SmsLog with PENDING status.
   */
  async queueSms(params: {
    businessId: string;
    branchId?: string | null;
    recipientPhone: string;
    messageBody: string;
    purpose?: SmsPurpose;
    senderId?: string;
  }) {
    const { allowed, used, quota } = await this.checkQuota(params.businessId);
    if (!allowed) {
      await this.notificationService.create({
        businessId: params.businessId,
        type: NotificationType.SYSTEM_ALERT,
        title: 'SMS Quota Exceeded',
        message: `Your monthly SMS quota of ${quota} messages has been reached (${used}/${quota}). Messages will not be dispatched.`,
      });
      throw new ForbiddenException({
        code: 'SMS_QUOTA_EXCEEDED',
        message: `Monthly SMS limit reached (${used}/${quota}). Please contact support to increase your quota.`,
      });
    }

    const optedOut = await this.isOptedOut(params.businessId, params.recipientPhone);
    if (optedOut && params.purpose === SmsPurpose.PROMOTIONAL) {
      return { skipped: true, reason: 'Recipient opted out of promotional SMS' };
    }

    const analysis = this.templateService.calculateSegments(params.messageBody);

    return this.prisma.smsLog.create({
      data: {
        business_id: params.businessId,
        branch_id: params.branchId ?? null,
        recipient_phone: params.recipientPhone,
        message_body: params.messageBody,
        sender_id: params.senderId || null,
        status: SmsStatus.PENDING,
        purpose: params.purpose || SmsPurpose.SALE_INVOICE,
        cost: analysis.estimatedCost,
      },
    });
  }

  /**
   * Previews customers eligible for due reminder SMS.
   */
  async previewDueReminders(
    businessId: string,
    minDue = 100,
    olderThanDays = 0,
    customerId?: string,
  ) {
    const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

    const customers = await this.prisma.customer.findMany({
      where: {
        business_id: businessId,
        deleted_at: null,
        ...(customerId ? { id: customerId } : {}),
        current_due: { gte: minDue },
        sales: olderThanDays > 0 ? { some: { sale_date: { lte: cutoffDate }, due_amount: { gt: 0 } } } : undefined,
      },
      select: {
        id: true,
        name: true,
        phone: true,
        current_due: true,
      },
    });

    return {
      eligibleCount: customers.length,
      customers: customers.slice(0, 50),
    };
  }

  /**
   * Sends due reminders to eligible customers.
   */
  async sendDueReminders(
    businessId: string,
    branchId: string,
    minDue = 100,
    olderThanDays = 0,
    customerId?: string,
    lang: 'en' | 'bn' = 'bn',
  ) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
    });

    const preview = await this.previewDueReminders(businessId, minDue, olderThanDays, customerId);

    const queuedLogs: any[] = [];
    for (const cust of preview.customers) {
      const body = this.templateService.render(SmsPurpose.DUE_REMINDER, lang, {
        customerName: cust.name,
        due: Number(cust.current_due),
        shopName: business?.name || 'Our Store',
      });

      const log = await this.queueSms({
        businessId,
        branchId,
        recipientPhone: cust.phone,
        messageBody: body,
        purpose: SmsPurpose.DUE_REMINDER,
      });
      queuedLogs.push(log);
    }

    return {
      queuedCount: queuedLogs.length,
      message: `Successfully queued ${queuedLogs.length} due reminder SMS.`,
    };
  }

  /**
   * Sends promotional campaign to target audience with opt-out filtering.
   */
  async sendPromotionalCampaign(
    businessId: string,
    branchId: string,
    customMessage: string,
    boughtInLastDays = 30,
    minSpend = 0,
    lang: 'en' | 'bn' = 'en',
  ) {
    const cutoffDate = new Date(Date.now() - boughtInLastDays * 24 * 60 * 60 * 1000);
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });

    // Find customers who purchased in target period
    const customers = await this.prisma.customer.findMany({
      where: {
        business_id: businessId,
        deleted_at: null,
        sales: {
          some: {
            sale_date: { gte: cutoffDate },
            total_amount: { gte: minSpend },
          },
        },
      },
      select: { id: true, name: true, phone: true },
    });

    let queuedCount = 0;
    for (const c of customers) {
      const isOptedOut = await this.isOptedOut(businessId, c.phone);
      if (isOptedOut) continue;

      const body = this.templateService.render(SmsPurpose.PROMOTIONAL, lang, {
        customerName: c.name,
        message: customMessage,
        shopName: business?.name || 'Our Store',
      });

      try {
        await this.queueSms({
          businessId,
          branchId,
          recipientPhone: c.phone,
          messageBody: body,
          purpose: SmsPurpose.PROMOTIONAL,
        });
        queuedCount++;
      } catch (err: any) {
        if (err.response?.code === 'SMS_QUOTA_EXCEEDED') break;
      }
    }

    return {
      totalAudience: customers.length,
      queuedCount,
      message: `Promotional campaign dispatched to ${queuedCount} recipients.`,
    };
  }

  /**
   * Sends OTP for sensitive actions.
   */
  async sendOtp(businessId: string, phone: string, otp: string, lang: 'en' | 'bn' = 'en') {
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    const body = this.templateService.render(SmsPurpose.OTP, lang, {
      otp,
      shopName: business?.name || 'POS System',
    });

    return this.queueSms({
      businessId,
      recipientPhone: phone,
      messageBody: body,
      purpose: SmsPurpose.OTP,
    });
  }

  /**
   * Lists SMS logs with branch/admin filtering.
   */
  async listLogs(
    businessId: string,
    branchId?: string,
    isOwner?: boolean,
    query: { page?: number; limit?: number; purpose?: SmsPurpose; status?: SmsStatus } = {},
  ) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { business_id: businessId };
    if (!isOwner && branchId) {
      where.branch_id = branchId;
    }
    if (query.purpose) where.purpose = query.purpose;
    if (query.status) where.status = query.status;

    const [logs, total] = await Promise.all([
      this.prisma.smsLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.smsLog.count({ where }),
    ]);

    return {
      data: logs,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
