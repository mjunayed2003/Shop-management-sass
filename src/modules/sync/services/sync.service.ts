import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { SaleService } from '../../sales/services/sale.service.js';
import { PlanLimitService } from '../../subscription/services/plan-limit.service.js';
import { NotificationService } from '../../notifications/notifications.service.js';
import {
  SyncStatus,
  SequenceType,
  NotificationType,
  Prisma,
} from '../../../generated/prisma/client.js';

export interface SyncPushItem {
  client_sync_id: string;
  entity_type: 'SALE' | 'CUSTOMER' | 'EXPENSE' | 'HELD_SALE';
  client_created_at: string;
  payload: any;
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly saleService: SaleService,
    private readonly planLimitService: PlanLimitService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Atomically reserves a block of unique invoice numbers for the branch.
   */
  async reserveInvoiceNumbers(
    businessId: string,
    branchId: string,
    count = 50,
  ): Promise<{
    prefix: string;
    from: number;
    to: number;
    count: number;
    server_time: string;
  }> {
    await this.planLimitService.checkFeature(businessId, 'has_offline_sync');

    const requestedCount = Math.min(Math.max(count || 50, 1), 200);

    return this.prisma.$transaction(async (tx) => {
      // Upsert sequence row if not exists
      await tx.invoiceSequence.upsert({
        where: {
          business_id_branch_id_sequence_type: {
            business_id: businessId,
            branch_id: branchId,
            sequence_type: SequenceType.SALE_INVOICE,
          },
        },
        update: {},
        create: {
          business_id: businessId,
          branch_id: branchId,
          sequence_type: SequenceType.SALE_INVOICE,
          prefix: 'INV-',
          current_value: 0,
        },
      });

      // Lock row
      const lockedRows = await tx.$queryRaw<
        Array<{ id: string; prefix: string; current_value: number }>
      >`
        SELECT id, prefix, current_value FROM invoice_sequences
        WHERE business_id = ${businessId}::uuid
          AND branch_id = ${branchId}::uuid
          AND sequence_type = 'SALE_INVOICE'
        FOR UPDATE
      `;

      const seq = lockedRows[0];
      const fromVal = seq.current_value + 1;
      const toVal = seq.current_value + requestedCount;

      await tx.invoiceSequence.update({
        where: { id: seq.id },
        data: { current_value: toVal },
      });

      return {
        prefix: seq.prefix,
        from: fromVal,
        to: toVal,
        count: requestedCount,
        server_time: new Date().toISOString(),
      };
    });
  }

  /**
   * Bootstrap endpoint supplying an offline client with products, prices, barcodes,
   * customers, taxes, and current branch stock snapshot. Supports ?updated_since=.
   */
  async getBootstrapData(
    businessId: string,
    branchId: string,
    userId: string,
    updatedSince?: string,
  ) {
    await this.planLimitService.checkFeature(businessId, 'has_offline_sync');

    const sinceDate = updatedSince ? new Date(updatedSince) : undefined;
    const sinceFilter = sinceDate && !isNaN(sinceDate.getTime()) ? { updated_at: { gte: sinceDate } } : {};

    // 1. Fetch active products in this branch
    const productBranches = await this.prisma.productBranch.findMany({
      where: {
        business_id: businessId,
        branch_id: branchId,
        is_active: true,
      },
      include: {
        product: {
          include: {
            category: true,
            brand: true,
            variants: {
              include: {
                size: true,
                color: true,
                stock_balances: {
                  where: { branch_id: branchId },
                },
              },
            },
          },
        },
      },
    });

    const products = productBranches.map((pb) => pb.product);

    // 2. Customers
    const customers = await this.prisma.customer.findMany({
      where: {
        business_id: businessId,
        deleted_at: null,
        ...sinceFilter,
      },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        current_due: true,
        credit_limit: true,
        loyalty_points: true,
        updated_at: true,
      },
      take: 1000,
    });

    // 3. Price Lists
    const priceLists = await this.prisma.priceList.findMany({
      where: { business_id: businessId, is_active: true },
      include: { items: true },
    });

    // 4. Coupons (without internal coupon limits / codes only)
    const coupons = await this.prisma.coupon.findMany({
      where: {
        business_id: businessId,
        is_active: true,
        valid_until: { gte: new Date() },
      },
      select: {
        id: true,
        code: true,
        discount_type: true,
        discount_value: true,
        min_purchase_amount: true,
        valid_until: true,
      },
    });

    // 5. User permissions
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: {
          include: {
            role_permissions: {
              include: { permission: true },
            },
          },
        },
      },
    });

    const permissions = user?.is_owner
      ? ['*']
      : (user?.role?.role_permissions || []).map((rp) => rp.permission.code);

    return {
      products,
      customers,
      priceLists,
      coupons,
      permissions,
      server_time: new Date().toISOString(),
    };
  }

  /**
   * Pushes a batch of offline actions. Each action runs in its own transaction.
   */
  async pushBatch(
    businessId: string,
    branchId: string,
    userId: string,
    items: SyncPushItem[],
  ) {
    await this.planLimitService.checkFeature(businessId, 'has_offline_sync');

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('Sync push batch cannot be empty.');
    }
    if (items.length > 100) {
      throw new BadRequestException('Sync push batch exceeds maximum limit of 100 items.');
    }

    const results: any[] = [];
    let processedCount = 0;
    let conflictCount = 0;
    let failedCount = 0;

    for (const item of items) {
      const outcome = await this.processSingleSyncItem(businessId, branchId, userId, item);
      results.push(outcome);

      if (outcome.status === SyncStatus.PROCESSED) processedCount++;
      else if (outcome.status === SyncStatus.CONFLICT) conflictCount++;
      else failedCount++;
    }

    return {
      processed: processedCount,
      conflicts: conflictCount,
      failed: failedCount,
      results,
      server_time: new Date().toISOString(),
    };
  }

  /**
   * Processes an individual sync operation in an isolated database transaction.
   */
  private async processSingleSyncItem(
    businessId: string,
    branchId: string,
    userId: string,
    item: SyncPushItem,
  ): Promise<{
    client_sync_id: string;
    entity_type: string;
    status: SyncStatus;
    result?: any;
    error_message?: string;
  }> {
    // 1. Upsert SyncQueue row
    const existingQueue = await this.prisma.syncQueue.findUnique({
      where: {
        business_id_branch_id_client_sync_id: {
          business_id: businessId,
          branch_id: branchId,
          client_sync_id: item.client_sync_id,
        },
      },
    });

    if (existingQueue && existingQueue.status === SyncStatus.PROCESSED) {
      return {
        client_sync_id: item.client_sync_id,
        entity_type: item.entity_type,
        status: SyncStatus.PROCESSED,
        result: existingQueue.payload,
      };
    }

    const syncQueueRecord = await this.prisma.syncQueue.upsert({
      where: {
        business_id_branch_id_client_sync_id: {
          business_id: businessId,
          branch_id: branchId,
          client_sync_id: item.client_sync_id,
        },
      },
      update: {
        retry_count: { increment: 1 },
      },
      create: {
        business_id: businessId,
        branch_id: branchId,
        client_sync_id: item.client_sync_id,
        entity_type: item.entity_type,
        payload: item.payload,
        status: SyncStatus.PENDING,
      },
    });

    // 2. Validate client_created_at
    const clientTime = new Date(item.client_created_at);
    const now = new Date();
    if (isNaN(clientTime.getTime())) {
      await this.prisma.syncQueue.update({
        where: { id: syncQueueRecord.id },
        data: { status: SyncStatus.FAILED, error_message: 'Invalid client_created_at date' },
      });
      return {
        client_sync_id: item.client_sync_id,
        entity_type: item.entity_type,
        status: SyncStatus.FAILED,
        error_message: 'Invalid client_created_at date',
      };
    }

    // Skew allowance: 5 minutes in future
    if (clientTime.getTime() > now.getTime() + 5 * 60 * 1000) {
      const err = 'Client timestamp cannot be in the future (exceeds clock skew threshold)';
      await this.prisma.syncQueue.update({
        where: { id: syncQueueRecord.id },
        data: { status: SyncStatus.FAILED, error_message: err },
      });
      return {
        client_sync_id: item.client_sync_id,
        entity_type: item.entity_type,
        status: SyncStatus.FAILED,
        error_message: err,
      };
    }

    // Age allowance: max 30 days
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (clientTime < thirtyDaysAgo) {
      const err = 'Offline operation is older than 30 days and cannot be synced directly';
      await this.prisma.syncQueue.update({
        where: { id: syncQueueRecord.id },
        data: { status: SyncStatus.FAILED, error_message: err },
      });
      return {
        client_sync_id: item.client_sync_id,
        entity_type: item.entity_type,
        status: SyncStatus.FAILED,
        error_message: err,
      };
    }

    // 3. Process according to entity type in its OWN transaction
    try {
      const transactionResult = await this.prisma.$transaction(async (tx) => {
        if (item.entity_type === 'CUSTOMER') {
          return this.processOfflineCustomer(tx, businessId, item.payload);
        }

        if (item.entity_type === 'SALE') {
          return this.processOfflineSale(tx, businessId, branchId, userId, item.payload, clientTime);
        }

        if (item.entity_type === 'EXPENSE') {
          return this.processOfflineExpense(tx, businessId, branchId, userId, item.payload);
        }

        throw new BadRequestException(`Unsupported offline entity type "${item.entity_type}".`);
      });

      const isConflict = Boolean((transactionResult as any)?.hasConflict);
      const conflictReason = (transactionResult as any)?.conflictReason;
      const status = isConflict ? SyncStatus.CONFLICT : SyncStatus.PROCESSED;

      await this.prisma.syncQueue.update({
        where: { id: syncQueueRecord.id },
        data: {
          status,
          processed_at: new Date(),
          error_message: isConflict ? conflictReason : null,
        },
      });

      return {
        client_sync_id: item.client_sync_id,
        entity_type: item.entity_type,
        status,
        result: transactionResult,
        error_message: isConflict ? conflictReason : undefined,
      };
    } catch (err: any) {
      this.logger.error(`Offline sync processing failed for ${item.client_sync_id}: ${err.message}`);

      const isForbiddenOrValidation =
        err.message?.includes('OFFLINE_NOT_ALLOWED') ||
        err.message?.includes('OFFLINE_RETURN_FORBIDDEN') ||
        err.response?.code === 'OFFLINE_NOT_ALLOWED' ||
        err.response?.code === 'OFFLINE_RETURN_FORBIDDEN';

      const finalStatus = isForbiddenOrValidation ? SyncStatus.CONFLICT : SyncStatus.FAILED;

      await this.prisma.syncQueue.update({
        where: { id: syncQueueRecord.id },
        data: {
          status: finalStatus,
          error_message: err.message || 'Processing failed',
        },
      });

      return {
        client_sync_id: item.client_sync_id,
        entity_type: item.entity_type,
        status: finalStatus,
        error_message: err.message,
      };
    }
  }

  /**
   * Handles offline customer deduplication by phone.
   */
  private async processOfflineCustomer(
    tx: Prisma.TransactionClient,
    businessId: string,
    payload: any,
  ) {
    const rawPhone = String(payload.phone || '').trim();
    if (!rawPhone) {
      throw new BadRequestException('Customer phone is required for offline sync.');
    }

    const normalizedPhone = rawPhone.replace(/\D/g, '').slice(-11);

    const existing = await tx.customer.findFirst({
      where: {
        business_id: businessId,
        phone: { endsWith: normalizedPhone },
        deleted_at: null,
      },
    });

    if (existing) {
      return {
        client_customer_ref: payload.client_ref || payload.id,
        server_customer_id: existing.id,
        isExisting: true,
      };
    }

    const created = await tx.customer.create({
      data: {
        business_id: businessId,
        name: payload.name || 'Walk-in Customer',
        phone: rawPhone,
        email: payload.email || null,
        address: payload.address || null,
        city: payload.city || null,
        credit_limit: payload.creditLimit ? new Prisma.Decimal(payload.creditLimit) : 0,
      },
    });

    return {
      client_customer_ref: payload.client_ref || payload.id,
      server_customer_id: created.id,
      isExisting: false,
    };
  }

  /**
   * Handles offline sale processing with allowNegativeStock, conflict detection,
   * closed session verification, and disallowed operation checks.
   */
  private async processOfflineSale(
    tx: Prisma.TransactionClient,
    businessId: string,
    branchId: string,
    userId: string,
    payload: any,
    clientTime: Date,
  ) {
    // 1. Guard against disallowed offline operations
    if (payload.isAutoTransfer || payload.transferFromBranchId) {
      throw new ForbiddenException({
        code: 'OFFLINE_NOT_ALLOWED',
        message: 'Cross-branch auto-transfers cannot be conducted offline.',
      });
    }
    if (payload.isVoidOnlineSale) {
      throw new ForbiddenException({
        code: 'OFFLINE_NOT_ALLOWED',
        message: 'Voiding an online sale cannot be done offline.',
      });
    }
    if (payload.isReturn) {
      throw new ForbiddenException({
        code: 'OFFLINE_RETURN_FORBIDDEN',
        message: 'Returns of online sales cannot be processed offline without ledger verification.',
      });
    }

    // 2. Register session check
    let hasClosedSessionConflict = false;
    let conflictReason: string | undefined;

    if (payload.registerSessionId) {
      const session = await tx.registerSession.findUnique({
        where: { id: payload.registerSessionId },
      });
      if (session && session.status === 'CLOSED' && session.closed_at && session.closed_at < clientTime) {
        hasClosedSessionConflict = true;
        conflictReason = `Register session "${payload.registerSessionId}" was already closed on server before offline sale.`;
      }
    }

    // 3. Execute sale via SaleService
    const saleResult: any = await this.saleService.executeSaleTransaction(
      tx,
      businessId,
      branchId,
      userId,
      payload,
      undefined,
      {
        tx,
        isOffline: true,
        syncedAt: new Date(),
        saleDate: clientTime,
        allowNegativeStock: true,
        reservedInvoiceNo: payload.invoiceNo,
      },
    );

    const negativeVariants = saleResult.negativeVariants || [];
    const hasNegativeStock = negativeVariants.length > 0;

    if (hasNegativeStock) {
      // Create SYSTEM_ALERT notification
      const variantSkus = negativeVariants.map((v: any) => `${v.sku} (${v.balance})`).join(', ');
      await this.notificationService.create({
        businessId,
        branchId,
        type: NotificationType.SYSTEM_ALERT,
        title: 'Negative Stock Warning (Offline Sync)',
        message: `Offline sale "${saleResult.invoiceNo}" caused negative stock on: ${variantSkus}. Please perform stock adjustment or count.`,
      });
    }

    if (saleResult.exceededCreditLimit) {
      await this.notificationService.create({
        businessId,
        branchId,
        type: NotificationType.SYSTEM_ALERT,
        title: 'Customer Credit Limit Exceeded (Offline Sync)',
        message: `Offline sale "${saleResult.invoiceNo}" exceeded customer credit limit. Total due incremented.`,
      });
    }

    const hasConflict = hasClosedSessionConflict || hasNegativeStock;
    const finalReason = conflictReason || (hasNegativeStock ? 'Sale caused negative stock' : undefined);

    return {
      sale: saleResult,
      hasConflict,
      conflictReason: finalReason,
      negativeVariants,
    };
  }

  /**
   * Handles offline expense processing.
   */
  private async processOfflineExpense(
    tx: Prisma.TransactionClient,
    businessId: string,
    branchId: string,
    userId: string,
    payload: any,
  ) {
    const amount = new Prisma.Decimal(payload.amount);
    const taxAmount = payload.taxAmount ? new Prisma.Decimal(payload.taxAmount) : new Prisma.Decimal(0);
    const totalAmount = amount.plus(taxAmount);

    return tx.expense.create({
      data: {
        business_id: businessId,
        branch_id: branchId,
        expense_category_id: payload.expenseCategoryId,
        expense_no: payload.expenseNo || `EXP-OFF-${Date.now()}`,
        amount,
        tax_amount: taxAmount,
        total_amount: totalAmount,
        expense_date: payload.expenseDate ? new Date(payload.expenseDate) : new Date(),
        vendor_name: payload.vendorName || null,
        receipt_no: payload.receiptNo || null,
        description: payload.description || null,
        payment_method: payload.paymentMethod || 'CASH',
        paid_from_register: payload.paidFromRegister || false,
        created_by: userId,
      },
    });
  }

  /**
   * Lists conflicts / failed items in the branch.
   */
  async getConflicts(businessId: string, branchId?: string, isOwner?: boolean) {
    const where: any = {
      business_id: businessId,
      status: { in: [SyncStatus.CONFLICT, SyncStatus.FAILED] },
    };
    if (!isOwner && branchId) {
      where.branch_id = branchId;
    }

    return this.prisma.syncQueue.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Retries a failed or conflicting sync item.
   */
  async retryItem(businessId: string, branchId: string, userId: string, queueId: string) {
    const item = await this.prisma.syncQueue.findFirst({
      where: { id: queueId, business_id: businessId },
    });
    if (!item) {
      throw new NotFoundException('Sync queue item not found.');
    }

    return this.processSingleSyncItem(businessId, branchId, userId, {
      client_sync_id: item.client_sync_id,
      entity_type: item.entity_type as any,
      client_created_at: item.created_at.toISOString(),
      payload: item.payload,
    });
  }

  /**
   * Resolves a conflict with manager notes.
   */
  async resolveConflict(businessId: string, queueId: string, notes: string) {
    const item = await this.prisma.syncQueue.findFirst({
      where: { id: queueId, business_id: businessId },
    });
    if (!item) {
      throw new NotFoundException('Sync queue item not found.');
    }

    return this.prisma.syncQueue.update({
      where: { id: queueId },
      data: {
        status: SyncStatus.PROCESSED,
        error_message: notes ? `Resolved: ${notes}` : 'Resolved by manager',
        processed_at: new Date(),
      },
    });
  }

  /**
   * Admin endpoint listing products with negative stock balances.
   */
  async getNegativeStockToResolve(businessId: string, branchId?: string) {
    return this.prisma.stockBalance.findMany({
      where: {
        business_id: businessId,
        ...(branchId ? { branch_id: branchId } : {}),
        quantity: { lt: 0 },
      },
      include: {
        product_variant: {
          select: {
            id: true,
            sku: true,
            retail_price: true,
            cost_price: true,
            product: { select: { id: true, name: true, code: true } },
          },
        },
        branch: { select: { id: true, name: true, code: true } },
      },
      orderBy: { quantity: 'asc' },
    });
  }

  /**
   * Sync status endpoint for the branch.
   */
  async getSyncStatus(businessId: string, branchId: string) {
    await this.planLimitService.checkFeature(businessId, 'has_offline_sync');

    const [pending, failed, conflict, lastProcessed] = await Promise.all([
      this.prisma.syncQueue.count({
        where: { business_id: businessId, branch_id: branchId, status: SyncStatus.PENDING },
      }),
      this.prisma.syncQueue.count({
        where: { business_id: businessId, branch_id: branchId, status: SyncStatus.FAILED },
      }),
      this.prisma.syncQueue.count({
        where: { business_id: businessId, branch_id: branchId, status: SyncStatus.CONFLICT },
      }),
      this.prisma.syncQueue.findFirst({
        where: { business_id: businessId, branch_id: branchId, status: SyncStatus.PROCESSED },
        orderBy: { processed_at: 'desc' },
        select: { processed_at: true },
      }),
    ]);

    return {
      pending,
      failed,
      conflict,
      lastSuccessfulSync: lastProcessed?.processed_at || null,
      server_time: new Date().toISOString(),
    };
  }
}
