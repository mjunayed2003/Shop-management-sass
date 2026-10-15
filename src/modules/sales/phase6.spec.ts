import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SubscriptionStatus,
  BillingCycle,
  PlatformInvoiceStatus,
  PlatformPaymentMethod,
  SmsPurpose,
  SmsStatus,
  SyncStatus,
  NotificationType,
  TicketStatus,
  TicketPriority,
  TicketSenderType,
  SuperAdminRole,
} from '../../generated/prisma/client.js';

import { PlanLimitService } from '../subscription/services/plan-limit.service.js';
import { PlatformSequenceService } from '../subscription/services/platform-sequence.service.js';
import { SubscriptionService } from '../subscription/services/subscription.service.js';
import { SubscriptionBillingService } from '../subscription/services/subscription-billing.service.js';
import { NotificationService } from '../notifications/notifications.service.js';
import { SmsTemplateService } from '../sms/services/sms-template.service.js';
import { SmsService } from '../sms/services/sms.service.js';
import { SmsWorkerService } from '../sms/services/sms-worker.service.js';
import { SyncService } from '../sync/services/sync.service.js';
import { PlatformAuthGuard } from '../platform/guards/platform-auth.guard.js';
import { PlatformSupportService } from '../platform/services/platform-support.service.js';
import { PlatformSettingsService } from '../platform/services/platform-settings.service.js';
import { DashboardService } from '../dashboard/dashboard.service.js';
import { ExportService } from '../export/export.service.js';
import { LoginLockoutService } from '../auth/login-lockout.service.js';

describe('Phase 6: Offline Sync, SMS, Notifications, Subscription & Billing, Super Admin, Dashboards, Hardening', () => {
  let mockPrisma: any;
  const businessId = 'biz-001';
  const branchId = 'branch-001';
  const userId = 'user-001';

  beforeEach(() => {
    mockPrisma = {
      $transaction: vi.fn().mockImplementation(async (cb: any) => cb(mockPrisma)),
      $queryRaw: vi.fn().mockResolvedValue([]),
      subscription: {
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
      },
      subscriptionOverride: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
      subscriptionInvoice: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
      },
      platformPayment: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
      plan: {
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      branch: {
        count: vi.fn().mockResolvedValue(1),
      },
      user: {
        count: vi.fn().mockResolvedValue(2),
      },
      product: {
        count: vi.fn().mockResolvedValue(10),
      },
      productVariant: {
        count: vi.fn().mockResolvedValue(20),
        findMany: vi.fn().mockResolvedValue([]),
      },
      sale: {
        count: vi.fn().mockResolvedValue(5),
        aggregate: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      saleItem: {
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue([]),
      },
      expense: {
        aggregate: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      customer: {
        aggregate: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
      },
      supplier: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { current_balance: new Prisma.Decimal(4000) } }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      stockBalance: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: new Prisma.Decimal(250) } }),
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
      },
      invoiceSequence: {
        upsert: vi.fn(),
        update: vi.fn(),
      },
      syncQueue: {
        findUnique: vi.fn(),
        create: vi.fn(),
        upsert: vi.fn().mockImplementation((args: any) => ({
          id: 'q-sync-1',
          ...args?.create,
          status: SyncStatus.PENDING,
        })),
        update: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      registerSession: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
      },
      notification: {
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockImplementation((args: any) => ({
          id: 'notif-created-1',
          ...args.data,
          created_at: new Date(),
        })),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      smsLog: {
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn(),
        update: vi.fn(),
      },
      supportTicket: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
      },
      supportTicketMessage: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
      systemSetting: {
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
    };
  });

  // ==========================================================================
  // A. OFFLINE SYNC
  // ==========================================================================
  describe('A. Offline Sync', () => {
    let syncService: SyncService;
    let planLimitService: PlanLimitService;
    let notificationService: NotificationService;
    let mockSaleService: any;

    beforeEach(() => {
      planLimitService = new PlanLimitService(mockPrisma);
      notificationService = new NotificationService(mockPrisma);
      mockSaleService = {
        createSale: vi.fn(),
      };
      syncService = new SyncService(
        mockPrisma,
        mockSaleService,
        planLimitService,
        notificationService,
      );

      // Default subscription with offline sync enabled
      mockPrisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        business_id: businessId,
        is_free_access: false,
        plan: {
          limits: {
            has_offline_sync: true,
            max_branches: 5,
            max_users: 10,
            max_products: 100,
            max_variants: 200,
            max_monthly_invoices: 1000,
            has_api_access: true,
            has_custom_reports: true,
          },
        },
      });
    });

    it('reserves invoice numbers atomically without duplicates across devices', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { id: 'seq-1', prefix: 'INV-GUL-', next_number: 101 },
      ]);

      const result = await syncService.reserveInvoiceNumbers(businessId, branchId, 50);

      expect(result.prefix).toBe('INV-GUL-');
      expect(result.from).toBe(101);
      expect(result.to).toBe(150);
      expect(result.count).toBe(50);
      expect(result.server_time).toBeDefined();

      expect(mockPrisma.invoiceSequence.update).toHaveBeenCalledWith({
        where: { id: 'seq-1' },
        data: { next_number: 151 },
      });
    });

    it('rejects /sync operations if subscription has_offline_sync is false', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        business_id: businessId,
        is_free_access: false,
        plan: {
          limits: {
            has_offline_sync: false,
          },
        },
      });

      await expect(
        syncService.reserveInvoiceNumbers(businessId, branchId, 10),
      ).rejects.toThrow(ForbiddenException);
    });

    it('is idempotent when same client_sync_id is pushed twice', async () => {
      mockPrisma.syncQueue.findUnique.mockResolvedValue({
        id: 'q-1',
        client_sync_id: 'sync-device1-001',
        status: SyncStatus.PROCESSED,
        payload: { sale_id: 'sale-offline-1', invoice_no: 'INV-101' },
        error_message: null,
      });

      const res = await syncService.pushBatch(businessId, branchId, userId, [
        {
          client_sync_id: 'sync-device1-001',
          entity_type: 'SALE',
          client_created_at: new Date().toISOString(),
          payload: { items: [] },
        },
      ]);

      expect(res.results).toHaveLength(1);
      expect(res.results[0].status).toBe(SyncStatus.PROCESSED);
      expect(res.results[0].result).toEqual({
        sale_id: 'sale-offline-1',
        invoice_no: 'INV-101',
      });
      expect(mockSaleService.createSale).not.toHaveBeenCalled();
    });

    it('ensures one bad item in a batch does not block the other items', async () => {
      const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const validDate = new Date().toISOString();

      mockPrisma.syncQueue.findUnique.mockResolvedValue(null);

      mockPrisma.customer.findFirst.mockResolvedValue(null);
      mockPrisma.customer.create.mockResolvedValue({
        id: 'cust-new-1',
        phone: '01711112233',
        name: 'Rahim Offline',
      });

      mockPrisma.registerSession.findFirst.mockResolvedValue({
        id: 'reg-session-1',
        status: 'OPEN',
      });

      const res = await syncService.pushBatch(businessId, branchId, userId, [
        {
          client_sync_id: 'sync-bad-1',
          entity_type: 'SALE',
          client_created_at: futureDate,
          payload: {},
        },
        {
          client_sync_id: 'sync-good-2',
          entity_type: 'CUSTOMER',
          client_created_at: validDate,
          payload: { phone: '01711112233', name: 'Rahim Offline' },
        },
      ]);

      expect(res.results).toHaveLength(2);
      expect(res.results[0].client_sync_id).toBe('sync-bad-1');
      expect(res.results[0].status).toBe(SyncStatus.FAILED);
      expect(res.results[0].error_message).toContain('future');

      expect(res.results[1].client_sync_id).toBe('sync-good-2');
      expect(res.results[1].status).toBe(SyncStatus.PROCESSED);
    });

    it('records offline sale with insufficient stock allowing negative stock and creating notification', async () => {
      mockPrisma.syncQueue.findUnique.mockResolvedValue(null);
      mockPrisma.registerSession.findFirst.mockResolvedValue({
        id: 'sess-1',
        status: 'OPEN',
      });

      mockSaleService.executeSaleTransaction = vi.fn().mockResolvedValue({
        id: 'sale-neg-1',
        invoiceNo: 'INV-101',
        negativeVariants: [{ sku: 'POLO-M-BLK', balance: -2 }],
      });

      const res = await syncService.pushBatch(businessId, branchId, userId, [
        {
          client_sync_id: 'sync-sale-neg',
          entity_type: 'SALE',
          client_created_at: new Date().toISOString(),
          payload: {
            invoiceNo: 'INV-101',
            registerSessionId: 'sess-1',
            items: [{ variant_id: 'var-polo-m', quantity: 2, unit_price: 500 }],
            payments: [{ method: 'CASH', amount: 1000 }],
          },
        },
      ]);

      expect(res.results[0].status).toBe(SyncStatus.CONFLICT);
      expect(res.results[0].error_message).toContain('negative stock');
      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: NotificationType.SYSTEM_ALERT,
            title: expect.stringContaining('Negative Stock Warning'),
          }),
        }),
      );
    });

    it('rejects disallowed offline operations like cross-branch transfers', async () => {
      mockPrisma.syncQueue.findUnique.mockResolvedValue(null);

      const res = await syncService.pushBatch(businessId, branchId, userId, [
        {
          client_sync_id: 'sync-transfer-1',
          entity_type: 'SALE',
          client_created_at: new Date().toISOString(),
          payload: {
            isAutoTransfer: true,
          },
        },
      ]);

      expect(res.results[0].status).toBe(SyncStatus.CONFLICT);
      expect(res.results[0].error_message).toContain('Cross-branch auto-transfers');
    });

    it('maps offline customer with an existing phone to existing customer', async () => {
      mockPrisma.syncQueue.findUnique.mockResolvedValue(null);

      mockPrisma.customer.findFirst.mockResolvedValue({
        id: 'cust-existing-88',
        phone: '+8801712345678',
        name: 'Existing Karim',
      });

      const res = await syncService.pushBatch(businessId, branchId, userId, [
        {
          client_sync_id: 'sync-cust-1',
          entity_type: 'CUSTOMER',
          client_created_at: new Date().toISOString(),
          payload: {
            client_ref: 'offline-cust-ref-1',
            phone: '01712345678',
            name: 'Karim',
          },
        },
      ]);

      expect(res.results[0].status).toBe(SyncStatus.PROCESSED);
      expect(res.results[0].result).toEqual({
        client_customer_ref: 'offline-cust-ref-1',
        server_customer_id: 'cust-existing-88',
        isExisting: true,
      });
      expect(mockPrisma.customer.create).not.toHaveBeenCalled();
    });

    it('marks sale as CONFLICT if register session was already closed on server', async () => {
      mockPrisma.syncQueue.findUnique.mockResolvedValue(null);

      mockPrisma.registerSession.findUnique.mockResolvedValue({
        id: 'sess-already-closed',
        status: 'CLOSED',
        closed_at: new Date(Date.now() - 60000),
      });

      mockSaleService.executeSaleTransaction = vi.fn().mockResolvedValue({
        id: 'sale-sess-conflict',
        invoiceNo: 'INV-102',
      });

      const res = await syncService.pushBatch(businessId, branchId, userId, [
        {
          client_sync_id: 'sync-closed-session-sale',
          entity_type: 'SALE',
          client_created_at: new Date().toISOString(),
          payload: {
            registerSessionId: 'sess-already-closed',
            items: [],
          },
        },
      ]);

      expect(res.results[0].status).toBe(SyncStatus.CONFLICT);
      expect(res.results[0].error_message).toContain('already closed on server');
    });

    it('rejects payload with client_created_at older than maximum permitted threshold', async () => {
      mockPrisma.syncQueue.findUnique.mockResolvedValue(null);

      const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();

      const res = await syncService.pushBatch(businessId, branchId, userId, [
        {
          client_sync_id: 'sync-ancient-sale',
          entity_type: 'SALE',
          client_created_at: thirtyOneDaysAgo,
          payload: {},
        },
      ]);

      expect(res.results[0].status).toBe(SyncStatus.FAILED);
      expect(res.results[0].error_message).toContain('older than 30 days');
    });
  });

  // ==========================================================================
  // B. SMS GATEWAY & WORKER
  // ==========================================================================
  describe('B. SMS Gateway & Worker', () => {
    let templateService: SmsTemplateService;
    let smsService: SmsService;
    let smsWorker: SmsWorkerService;
    let mockProvider: any;

    beforeEach(() => {
      templateService = new SmsTemplateService();
      smsService = new SmsService(
        mockPrisma,
        templateService,
        new NotificationService(mockPrisma),
      );
      mockProvider = {
        sendSms: vi.fn().mockResolvedValue({
          success: true,
          providerRef: 'msg-bd-999',
          cost: 0.35,
        }),
      };
      smsWorker = new SmsWorkerService(mockPrisma, mockProvider);
    });

    it('renders templates in English and Bangla and calculates Unicode segments correctly', () => {
      const enText = templateService.render(SmsPurpose.SALE_INVOICE, 'en', {
        shopName: 'Outfit Store',
        invoiceNo: 'INV-101',
        total: '1500',
        paid: '1500',
        due: '0',
      });
      expect(enText).toContain('Outfit Store');
      expect(enText).toContain('INV-101');
      expect(templateService.calculateSegments(enText).isUnicode).toBe(false);

      const bnText = templateService.render(SmsPurpose.SALE_INVOICE, 'bn', {
        shopName: 'আউটফিট স্টোর',
        invoiceNo: 'INV-102',
        total: '1500',
        paid: '1300',
        due: '200',
      });
      expect(bnText).toContain('আউটফিট স্টোর');
      expect(templateService.calculateSegments(bnText).isUnicode).toBe(true);

      const enCalc = templateService.calculateSegments(enText);
      expect(enCalc.segmentCount).toBe(1);
      const longBnText = 'ধন্যবাদ '.repeat(30);
      const bnCalc = templateService.calculateSegments(longBnText);
      expect(bnCalc.isUnicode).toBe(true);
      expect(bnCalc.segmentCount).toBeGreaterThan(1);
    });

    it('enforces monthly quota and prevents queuing when limit is reached', async () => {
      mockPrisma.systemSetting.findUnique.mockResolvedValue({
        key: `sms_quota:${businessId}`,
        value: '100',
      });
      mockPrisma.smsLog.count.mockResolvedValue(100);

      await expect(
        smsService.queueSms({
          businessId,
          recipientPhone: '01711223344',
          purpose: SmsPurpose.PROMOTIONAL,
          messageBody: 'Sale alert',
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: NotificationType.SYSTEM_ALERT,
            title: 'SMS Quota Exceeded',
          }),
        }),
      );
    });

    it('worker claims pending messages using SKIP LOCKED and updates provider ref and cost', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ id: 'sms-log-1' }]);
      mockPrisma.smsLog.findMany.mockResolvedValue([
        {
          id: 'sms-log-1',
          business_id: businessId,
          recipient_phone: '01711112222',
          message_body: 'Hello Customer',
          sender_id: 'SHOP',
          retry_count: 0,
        },
      ]);

      const result = await smsWorker.processPendingMessages(10);
      expect(result.sent).toBe(1);
      expect(result.failed).toBe(0);

      expect(mockProvider.sendSms).toHaveBeenCalledWith(
        '01711112222',
        'Hello Customer',
        'SHOP',
      );

      expect(mockPrisma.smsLog.update).toHaveBeenCalledWith({
        where: { id: 'sms-log-1' },
        data: expect.objectContaining({
          status: SmsStatus.SENT,
          provider_ref: 'msg-bd-999',
          cost: 0.35,
        }),
      });
    });

    it('retries failed message with exponential backoff up to limit then marks FAILED', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ id: 'sms-log-fail' }]);
      mockPrisma.smsLog.findMany.mockResolvedValue([
        {
          id: 'sms-log-fail',
          business_id: businessId,
          recipient_phone: '01711112222',
          message_body: 'Fail Test',
          sender_id: 'SHOP',
          retry_count: 2,
        },
      ]);
      mockProvider.sendSms.mockResolvedValue({
        success: false,
        errorMessage: 'Network Timeout',
      });

      const result = await smsWorker.processPendingMessages(10);
      expect(result.failed).toBe(1);

      expect(mockPrisma.smsLog.update).toHaveBeenCalledWith({
        where: { id: 'sms-log-fail' },
        data: expect.objectContaining({
          status: SmsStatus.FAILED,
          provider_ref: 'Network Timeout',
        }),
      });
    });
  });

  // ==========================================================================
  // C. NOTIFICATIONS
  // ==========================================================================
  describe('C. Notifications', () => {
    let notificationService: NotificationService;

    beforeEach(() => {
      notificationService = new NotificationService(mockPrisma);
    });

    it('suppresses duplicate notifications created within the suppression window', async () => {
      const existingNotif = {
        id: 'notif-existing-1',
        title: 'Low stock for POLO-M',
        type: NotificationType.LOW_STOCK,
        is_read: false,
      };
      mockPrisma.notification.findFirst.mockResolvedValue(existingNotif);

      const result = await notificationService.create({
        businessId,
        branchId,
        type: NotificationType.LOW_STOCK,
        title: 'Low stock for POLO-M',
        message: 'Current stock is 2',
      });

      expect(result.id).toBe('notif-existing-1');
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });

    it('scopes list of notifications strictly to allowed branches and targets', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([
        { id: 'notif-1', title: 'Branch Gulshan Alert', branch_id: branchId },
      ]);

      const res = await notificationService.listNotifications(
        businessId,
        userId,
        [branchId],
        false,
      );

      expect(res.data).toHaveLength(1);
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            business_id: businessId,
            OR: expect.arrayContaining([
              { user_id: userId },
              { user_id: null, branch_id: { in: [branchId] } },
              { user_id: null, branch_id: null },
            ]),
          }),
        }),
      );
    });

    it('streams real-time SSE notifications filtered to user branches', async () => {
      const stream = notificationService.getEventStream(businessId, userId, [branchId], false);
      const events: any[] = [];
      const sub = stream.subscribe((event) => events.push(event.data));

      mockPrisma.notification.findFirst.mockResolvedValue(null);
      mockPrisma.notification.create.mockResolvedValue({
        id: 'sse-notif-1',
        business_id: businessId,
        branch_id: branchId,
        user_id: null,
        type: NotificationType.TRANSFER_REQUEST,
        title: 'Stock Transfer',
        message: 'New request',
        created_at: new Date(),
      });

      await notificationService.create({
        businessId,
        branchId,
        type: NotificationType.TRANSFER_REQUEST,
        title: 'Stock Transfer',
        message: 'New request',
      });

      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('sse-notif-1');
      sub.unsubscribe();
    });
  });

  // ==========================================================================
  // D. SUBSCRIPTION & BILLING
  // ==========================================================================
  describe('D. Subscription & Billing', () => {
    let planLimitService: PlanLimitService;
    let sequenceService: PlatformSequenceService;
    let subscriptionService: SubscriptionService;
    let billingService: SubscriptionBillingService;

    beforeEach(() => {
      planLimitService = new PlanLimitService(mockPrisma);
      sequenceService = new PlatformSequenceService(mockPrisma);
      subscriptionService = new SubscriptionService(
        mockPrisma,
        sequenceService,
        planLimitService,
      );
      billingService = new SubscriptionBillingService(
        mockPrisma,
        sequenceService,
      );
    });

    it('enforces branch limits and elevates them when an active override exists', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        business_id: businessId,
        is_free_access: false,
        plan: {
          limits: {
            max_branches: 2,
            max_users: 5,
            max_products: 50,
            max_variants: 100,
            max_monthly_invoices: 500,
          },
        },
      });

      mockPrisma.branch.count.mockResolvedValue(2);

      await expect(
        planLimitService.checkBranchLimit(businessId),
      ).rejects.toThrow(ForbiddenException);

      // With active override raising max_branches to 7
      mockPrisma.subscriptionOverride.findMany.mockResolvedValue([
        {
          business_id: businessId,
          override_max_branches: 7,
          valid_until: new Date(Date.now() + 86400000),
        },
      ]);

      await expect(
        planLimitService.checkBranchLimit(businessId),
      ).resolves.not.toThrow();
    });

    it('bypasses limits when subscription has is_free_access = true', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-free',
        business_id: businessId,
        is_free_access: true,
        plan: {
          limits: {
            max_branches: 1,
          },
        },
      });

      mockPrisma.branch.count.mockResolvedValue(10);
      await expect(
        planLimitService.checkBranchLimit(businessId),
      ).resolves.not.toThrow();
    });

    it('executes state transitions: TRIAL -> PAYMENT_DUE -> GRACE -> SUSPENDED', async () => {
      const now = new Date();
      const past = new Date(Date.now() - 100000);

      // 1. Trial ended -> PAYMENT_DUE
      mockPrisma.subscription.findMany.mockResolvedValueOnce([
        {
          id: 'sub-trial-end',
          business_id: businessId,
          status: SubscriptionStatus.TRIAL,
          trial_ends_at: past,
          billing_cycle: BillingCycle.MONTHLY,
          plan: { monthly_price: new Prisma.Decimal(2000), yearly_price: new Prisma.Decimal(20000) },
        },
      ]);

      mockPrisma.$queryRaw.mockResolvedValue([{ key: 'seq:platform_invoice', value: '10' }]);

      const cycle1 = await billingService.processDailyBillingCycle();
      expect(cycle1.invoicesIssued).toBe(1);
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-trial-end' },
          data: expect.objectContaining({ status: SubscriptionStatus.PAYMENT_DUE }),
        }),
      );

      // 2. Running billing job twice creates one invoice (idempotency check)
      mockPrisma.subscriptionInvoice.create.mockClear();
      mockPrisma.subscriptionInvoice.findFirst.mockResolvedValue({ id: 'inv-existing-period' });
      const duplicateIssued = await billingService.issuePeriodInvoice(
        {
          id: 'sub-trial-end',
          business_id: businessId,
          billing_cycle: BillingCycle.MONTHLY,
          plan: { monthly_price: new Prisma.Decimal(2000) },
        },
        [],
        now,
      );
      expect(duplicateIssued).toBe(false);
      expect(mockPrisma.subscriptionInvoice.create).not.toHaveBeenCalled();

      // 3. Grace expired -> SUSPENDED
      mockPrisma.subscription.findMany.mockResolvedValueOnce([
        {
          id: 'sub-grace-expired',
          business_id: businessId,
          status: SubscriptionStatus.GRACE,
          grace_ends_at: past,
        },
      ]);

      const cycle3 = await billingService.processDailyBillingCycle();
      expect(cycle3.suspended).toBe(1);
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-grace-expired' },
          data: expect.objectContaining({ status: SubscriptionStatus.SUSPENDED }),
        }),
      );
    });

    it('records partial payment then full payment transitioning subscription to ACTIVE', async () => {
      mockPrisma.subscriptionInvoice.findUnique.mockResolvedValue({
        id: 'inv-p-1',
        business_id: businessId,
        subscription_id: 'sub-1',
        net_amount: new Prisma.Decimal(1000),
        paid_amount: new Prisma.Decimal(0),
        status: PlatformInvoiceStatus.ISSUED,
        payments: [],
        subscription: {
          id: 'sub-1',
          billing_cycle: BillingCycle.MONTHLY,
          current_period_end: new Date(),
        },
      });

      // Partial payment of 400
      mockPrisma.platformPayment.findMany.mockResolvedValueOnce([
        { amount: new Prisma.Decimal(400) },
      ]);
      mockPrisma.platformPayment.create.mockResolvedValue({ id: 'pay-1', amount: new Prisma.Decimal(400) });

      const resPartial = await subscriptionService.recordPayment(
        'inv-p-1',
        400,
        PlatformPaymentMethod.BKASH,
        'TRX-BKASH-1',
      );

      expect(resPartial.invoiceStatus).toBe(PlatformInvoiceStatus.ISSUED);
      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();

      // Full remaining payment of 600
      mockPrisma.subscriptionInvoice.findUnique.mockResolvedValue({
        id: 'inv-p-1',
        business_id: businessId,
        subscription_id: 'sub-1',
        net_amount: new Prisma.Decimal(1000),
        paid_amount: new Prisma.Decimal(400),
        status: PlatformInvoiceStatus.ISSUED,
        payments: [{ amount: new Prisma.Decimal(400) }],
        subscription: {
          id: 'sub-1',
          billing_cycle: BillingCycle.MONTHLY,
          current_period_end: new Date(),
        },
      });

      mockPrisma.platformPayment.findMany.mockResolvedValueOnce([
        { amount: new Prisma.Decimal(400) },
        { amount: new Prisma.Decimal(600) },
      ]);

      const resFull = await subscriptionService.recordPayment(
        'inv-p-1',
        600,
        PlatformPaymentMethod.BKASH,
        'TRX-BKASH-2',
      );

      expect(resFull.invoiceStatus).toBe(PlatformInvoiceStatus.PAID);
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-1' },
          data: expect.objectContaining({
            status: SubscriptionStatus.ACTIVE,
            grace_ends_at: null,
          }),
        }),
      );
    });
  });

  // ==========================================================================
  // E. SUPER ADMIN / PLATFORM API
  // ==========================================================================
  describe('E. Super Admin / Platform API', () => {
    let authGuard: PlatformAuthGuard;
    let settingsService: PlatformSettingsService;
    let supportService: PlatformSupportService;
    let mockJwtService: any;
    let mockReflector: any;

    beforeEach(() => {
      mockJwtService = {
        verifyAsync: vi.fn(),
      };
      mockReflector = {
        getAllAndOverride: vi.fn(),
      };
      authGuard = new PlatformAuthGuard(mockJwtService, mockReflector, mockPrisma);
      settingsService = new PlatformSettingsService(mockPrisma);
      supportService = new PlatformSupportService(
        mockPrisma,
        new PlatformSequenceService(mockPrisma),
        new NotificationService(mockPrisma),
      );
    });

    it('rejects business user tokens on platform routes', async () => {
      mockJwtService.verifyAsync.mockResolvedValue({
        sub: 'user-biz',
        business_id: 'biz-1',
        aud: 'tenant',
      });

      const mockCtx: any = {
        getHandler: () => {},
        getClass: () => {},
        switchToHttp: () => ({
          getRequest: () => ({
            headers: { authorization: 'Bearer tenant-token' },
          }),
        }),
      };

      await expect(authGuard.canActivate(mockCtx)).rejects.toThrow();
    });

    it('enforces platform roles strictly (PLATFORM_SUPPORT cannot access billing endpoints)', async () => {
      mockJwtService.verifyAsync.mockResolvedValue({
        sub: 'admin-support-1',
        aud: 'platform',
      });
      mockPrisma.superAdmin = {
        findUnique: vi.fn().mockResolvedValue({
          id: 'admin-support-1',
          role: SuperAdminRole.PLATFORM_SUPPORT,
          is_active: true,
        }),
      };
      mockReflector.getAllAndOverride
        .mockReturnValueOnce(false)
        .mockReturnValueOnce([SuperAdminRole.SUPER_ADMIN, SuperAdminRole.BILLING_ADMIN]);

      const mockCtx: any = {
        getHandler: () => {},
        getClass: () => {},
        switchToHttp: () => ({
          getRequest: () => ({
            headers: { authorization: 'Bearer platform-valid-token' },
          }),
        }),
      };

      await expect(authGuard.canActivate(mockCtx)).rejects.toThrow(ForbiddenException);
    });

    it('masks encrypted system settings in listing responses', async () => {
      mockPrisma.systemSetting.findMany.mockResolvedValue([
        {
          key: 'sms_provider_api_key',
          value: 'iv:tag:ciphered-secret',
          is_encrypted: true,
        },
        {
          key: 'trial_days_default',
          value: '14',
          is_encrypted: false,
        },
      ]);

      const settings = await settingsService.listSettings();
      expect(settings[0].value).toBe('******');
      expect(settings[1].value).toBe('14');
    });

    it('manages support ticket messages and isolates tickets per tenant', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ key: 'seq:support_ticket', value: '50' }]);

      mockPrisma.supportTicket.create.mockResolvedValue({
        id: 'tick-1',
        ticket_no: 'TICK-000051',
        business_id: businessId,
        subject: 'Offline sync query',
      });

      const ticket = await supportService.createBusinessTicket(businessId, userId, {
        subject: 'Offline sync query',
        description: 'How to reserve invoice numbers?',
        priority: TicketPriority.HIGH,
      });

      expect(ticket.ticket_no).toBe('TICK-000051');
      expect(mockPrisma.supportTicketMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ticket_id: 'tick-1',
          sender_type: TicketSenderType.BUSINESS_USER,
          sender_user_id: userId,
          message: 'How to reserve invoice numbers?',
        }),
      });

      // Tenant isolation: requesting ticket belonging to other business throws NotFoundException
      mockPrisma.supportTicket.findFirst.mockResolvedValue(null);

      await expect(
        supportService.getBusinessTicketThread(businessId, 'tick-other'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ==========================================================================
  // F. DASHBOARDS & EXPORTS
  // ==========================================================================
  describe('F. Dashboards & Exports', () => {
    let dashboardService: DashboardService;
    let exportService: ExportService;

    beforeEach(() => {
      dashboardService = new DashboardService(mockPrisma);
      exportService = new ExportService(mockPrisma);
    });

    it('calculates dashboard metrics and hides profit when user lacks permission', async () => {
      mockPrisma.sale.aggregate
        .mockResolvedValueOnce({
          _sum: { total_amount: new Prisma.Decimal(5000), total_cost: new Prisma.Decimal(3000) },
          _count: { id: 10 },
        })
        .mockResolvedValueOnce({
          _sum: { total_amount: new Prisma.Decimal(25000), total_cost: new Prisma.Decimal(15000) },
          _count: { id: 50 },
        })
        .mockResolvedValueOnce({
          _sum: { total_amount: new Prisma.Decimal(100000), total_cost: new Prisma.Decimal(60000) },
          _count: { id: 200 },
        });

      mockPrisma.expense.aggregate.mockResolvedValue({
        _sum: { total_amount: new Prisma.Decimal(1200) },
      });

      mockPrisma.customer.aggregate.mockResolvedValue({
        _sum: { current_due: new Prisma.Decimal(8000) },
      });
      mockPrisma.stockBalance.count.mockResolvedValue(3);

      // 1. Without canViewProfit permission
      const noProfitDash = await dashboardService.getBusinessDashboard(
        businessId,
        branchId,
        false,
        false,
      );

      expect(noProfitDash.profit).toBeUndefined();
      expect(noProfitDash.sales.today.revenue).toBe(5000);
      expect(noProfitDash.receivables).toBe(8000);
      expect(noProfitDash.payables).toBe(4000);

      // 2. With canViewProfit permission
      mockPrisma.sale.aggregate
        .mockResolvedValueOnce({
          _sum: { total_amount: new Prisma.Decimal(5000), total_cost: new Prisma.Decimal(3000) },
          _count: { id: 10 },
        })
        .mockResolvedValueOnce({
          _sum: { total_amount: new Prisma.Decimal(25000), total_cost: new Prisma.Decimal(15000) },
          _count: { id: 50 },
        })
        .mockResolvedValueOnce({
          _sum: { total_amount: new Prisma.Decimal(100000), total_cost: new Prisma.Decimal(60000) },
          _count: { id: 200 },
        });

      mockPrisma.saleItem.groupBy.mockResolvedValue([
        { variant_id: 'var-1', _sum: { quantity: new Prisma.Decimal(5) } },
      ]);
      mockPrisma.productVariant.count.mockResolvedValue(1);

      const profitDash = await dashboardService.getBusinessDashboard(
        'biz-profit-test',
        branchId,
        false,
        true,
      );
      expect(profitDash.profit).toBeDefined();
    });

    it('sanitizes CSV cells against formula injection attacks', () => {
      const maliciousCells = ['=cmd|"/C calc"!A0', '+12345', '-SUM(A1:A5)', '@HYPERLINK("http://evil.com")'];
      for (const cell of maliciousCells) {
        const sanitized = exportService.sanitizeCell(cell);
        // Formula injection prefix `'` must be prepended before the malicious trigger character
        expect(sanitized.includes("'=") || sanitized.includes("'+") || sanitized.includes("'-") || sanitized.includes("'@")).toBe(true);
      }

      const normalCell = exportService.sanitizeCell('Polo Shirt Blue');
      expect(normalCell).toBe('Polo Shirt Blue');
    });

    it('exports sales formatted as valid CSV', async () => {
      mockPrisma.sale.findMany.mockResolvedValue([
        {
          invoice_no: 'INV-101',
          sale_date: new Date('2026-10-01T12:00:00Z'),
          branch: { name: 'Gulshan Branch' },
          customer: { name: 'Rahim' },
          status: 'COMPLETED',
          total_amount: new Prisma.Decimal(1500),
          paid_amount: new Prisma.Decimal(1500),
          due_amount: new Prisma.Decimal(0),
        },
      ]);

      const csv = await exportService.exportSales(businessId, branchId, false);
      expect(csv).toContain('Invoice No,Date,Branch,Customer,Status,Total,Paid,Due');
      expect(csv).toContain('INV-101');
      expect(csv).toContain('Gulshan Branch');
      expect(csv).toContain('1500');
    });
  });

  // ==========================================================================
  // G. HARDENING & LOGIN LOCKOUT
  // ==========================================================================
  describe('G. Hardening & Login Lockout', () => {
    let lockoutService: LoginLockoutService;

    beforeEach(() => {
      lockoutService = new LoginLockoutService();
    });

    it('locks out account after 5 consecutive failed login attempts', () => {
      const email = 'user@example.com';
      const ip = '192.168.1.100';

      for (let i = 0; i < 4; i++) {
        lockoutService.recordFailure(email, ip);
        expect(() => lockoutService.checkLockout(email, ip)).not.toThrow();
      }

      // 5th attempt triggers lockout
      lockoutService.recordFailure(email, ip);
      expect(() => lockoutService.checkLockout(email, ip)).toThrow(ForbiddenException);

      // Successful login resets lockout
      lockoutService.recordSuccess(email, ip);
      expect(() => lockoutService.checkLockout(email, ip)).not.toThrow();
    });
  });
});
