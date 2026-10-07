import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { SequenceService } from '../../inventory/services/sequence.service.js';
import { RegisterSessionService } from './register-session.service.js';
import { SmsStubService } from './sms-stub.service.js';
import {
  CreateDueCollectionDto,
  DueCollectionQueryDto,
} from '../dto/due-collection.dto.js';
import { Prisma } from '../../../generated/prisma/client.js';

@Injectable()
export class DueCollectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequenceService: SequenceService,
    private readonly registerSessionService: RegisterSessionService,
    private readonly smsStubService: SmsStubService,
  ) {}

  /**
   * Collects customer due in ONE atomic transaction.
   * Allocates amount oldest-first across sales (even from other branches).
   */
  async collectDue(
    businessId: string,
    currentBranchId: string,
    userId: string,
    dto: CreateDueCollectionDto,
  ) {
    // 0. Idempotency Check
    const existingCollection = await this.prisma.dueCollection.findFirst({
      where: {
        business_id: businessId,
        idempotency_key: dto.idempotencyKey,
      },
      include: {
        customer: true,
      },
    });

    if (existingCollection) {
      return existingCollection;
    }

    const payAmount = new Prisma.Decimal(dto.amount);
    if (payAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Collection amount must be greater than zero.');
    }

    return this.prisma.$transaction(
      async (tx) => {
        // 1. Lock customer row
        await tx.$queryRaw`
          SELECT id FROM customers
          WHERE id = ${dto.customerId}::uuid
          FOR UPDATE
        `;

        const customer = await tx.customer.findFirst({
          where: {
            id: dto.customerId,
            business_id: businessId,
          },
        });

        if (!customer) {
          throw new NotFoundException(`Customer "${dto.customerId}" not found.`);
        }

        const currentDue = new Prisma.Decimal(customer.current_due);

        // 2. Overpayment rule (advance payments rejected)
        if (payAmount.greaterThan(currentDue)) {
          throw new BadRequestException(
            `Payment amount (BDT ${payAmount.toString()}) cannot exceed customer outstanding due (BDT ${currentDue.toString()}). Advance payments are not supported.`,
          );
        }

        // 3. Register session check for CASH
        let activeSessionId: string | null = null;
        if (dto.paymentMethod === 'CASH') {
          const session = await this.registerSessionService.validateActiveSession(
            businessId,
            currentBranchId,
            userId,
          );
          activeSessionId = session.id;
        } else {
          const userSession = await tx.registerSession.findFirst({
            where: {
              business_id: businessId,
              branch_id: currentBranchId,
              user_id: userId,
              status: 'OPEN',
            },
          });
          if (userSession) {
            activeSessionId = userSession.id;
          }
        }

        // 4. Find customer due sales ordered oldest first
        const dueSales = await tx.sale.findMany({
          where: {
            business_id: businessId,
            customer_id: customer.id,
            due_amount: { gt: 0 },
            status: { in: ['DUE', 'PARTIALLY_PAID'] },
          },
          orderBy: { sale_date: 'asc' },
        });

        // Lock due sale rows
        if (dueSales.length > 0) {
          const saleIds = dueSales.map((s) => s.id);
          await tx.$queryRaw`
            SELECT id FROM sales
            WHERE id = ANY(${saleIds}::uuid[])
            FOR UPDATE
          `;
        }

        // 5. Allocate amount oldest first
        let remaining = payAmount;
        const allocations: Array<{
          saleId: string;
          invoiceNo: string;
          branchId: string;
          amountApplied: string;
        }> = [];

        for (const sale of dueSales) {
          if (remaining.lessThanOrEqualTo(0)) break;

          const sDue = new Prisma.Decimal(sale.due_amount);
          const alloc = Prisma.Decimal.min(remaining, sDue);

          const newDue = sDue.minus(alloc);
          const newPaid = new Prisma.Decimal(sale.paid_amount).plus(alloc);
          const newStatus = newDue.isZero() ? 'COMPLETED' : 'PARTIALLY_PAID';

          await tx.sale.update({
            where: { id: sale.id },
            data: {
              due_amount: newDue,
              paid_amount: newPaid,
              status: newStatus,
            },
          });

          allocations.push({
            saleId: sale.id,
            invoiceNo: sale.invoice_no,
            branchId: sale.branch_id,
            amountApplied: alloc.toString(),
          });

          remaining = remaining.minus(alloc);
        }

        // Any remaining amount was absorbed by customer opening_due portion
        // 6. Decrease Customer.current_due atomically
        const updatedCustomer = await tx.customer.update({
          where: { id: customer.id },
          data: {
            current_due: {
              decrement: payAmount,
            },
          },
        });

        // 7. Generate collection_no atomically via InvoiceSequence (DUE_COLLECTION)
        const collectionNo = await this.sequenceService.getNextNumber(
          tx,
          businessId,
          currentBranchId,
          'DUE_COLLECTION',
          'COL-',
        );

        // 8. Create DueCollection record
        const collection = await tx.dueCollection.create({
          data: {
            business_id: businessId,
            branch_id: currentBranchId,
            customer_id: customer.id,
            payment_account_id: null,
            register_session_id: activeSessionId,
            collection_no: collectionNo,
            idempotency_key: dto.idempotencyKey,
            amount: payAmount,
            payment_method: dto.paymentMethod,
            transaction_no: dto.transactionNo || null,
            notes: dto.notes || null,
            created_by: userId,
          },
          include: {
            customer: true,
          },
        });

        // 9. Optional SMS Queue
        if (customer.phone) {
          await this.smsStubService.sendSms(tx, {
            businessId,
            branchId: currentBranchId,
            recipientPhone: customer.phone,
            message: `Payment received: BDT ${payAmount.toString()}. Collection No: ${collectionNo}. Remaining due: BDT ${updatedCustomer.current_due.toString()}.`,
            purpose: 'DUE_REMINDER',
          });
        }

        // 10. Audit Log
        await tx.auditLog.create({
          data: {
            business_id: businessId,
            branch_id: currentBranchId,
            user_id: userId,
            action: 'CREATE',
            entity_table: 'due_collections',
            entity_id: collection.id,
            new_values: {
              collection_no: collectionNo,
              customer_id: customer.id,
              amount: payAmount.toString(),
              payment_method: dto.paymentMethod,
              allocations,
              remaining_due: updatedCustomer.current_due.toString(),
            },
          },
        });

        return {
          ...collection,
          allocations,
          customerName: customer.name,
          customerPhone: customer.phone,
          remainingDue: updatedCustomer.current_due.toString(),
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  /**
   * List due collections (branch-scoped, admin can view all).
   */
  async getDueCollectionList(
    businessId: string,
    branchId: string,
    query: DueCollectionQueryDto,
    isAllBranchAdmin: boolean = false,
  ) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.DueCollectionWhereInput = {
      business_id: businessId,
      ...(isAllBranchAdmin ? {} : { branch_id: branchId }),
      ...(query.customerId ? { customer_id: query.customerId } : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.dueCollection.count({ where }),
      this.prisma.dueCollection.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          branch: { select: { id: true, name: true, code: true } },
        },
      }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Detail of a single DueCollection.
   */
  async getDueCollectionDetail(
    businessId: string,
    branchId: string,
    collectionId: string,
    isAllBranchAdmin: boolean = false,
  ) {
    const record = await this.prisma.dueCollection.findFirst({
      where: {
        id: collectionId,
        business_id: businessId,
        ...(isAllBranchAdmin ? {} : { branch_id: branchId }),
      },
      include: {
        customer: true,
        branch: true,
      },
    });

    if (!record) {
      throw new NotFoundException(
        `Due collection with ID "${collectionId}" not found in this branch context.`,
      );
    }

    return record;
  }

  /**
   * Receipt data for printing collection slip.
   */
  async getDueReceipt(
    businessId: string,
    branchId: string,
    collectionId: string,
    isAllBranchAdmin: boolean = false,
  ) {
    const record = await this.getDueCollectionDetail(
      businessId,
      branchId,
      collectionId,
      isAllBranchAdmin,
    );

    return {
      receiptTitle: 'DUE COLLECTION MONEY RECEIPT',
      collectionNo: record.collection_no,
      date: record.receipt_date,
      branch: {
        name: record.branch.name,
        address: record.branch.address,
        phone: record.branch.phone,
      },
      customer: {
        id: record.customer.id,
        name: record.customer.name,
        phone: record.customer.phone,
        currentDue: record.customer.current_due.toString(),
      },
      amountPaid: record.amount.toString(),
      paymentMethod: record.payment_method,
      transactionNo: record.transaction_no,
      notes: record.notes,
    };
  }

  /**
   * Report: Customers with outstanding due with aging buckets (0-30, 31-60, 61-90, 90+ days)
   * and last purchase date.
   */
  async getOutstandingDueReport(businessId: string) {
    const customers = await this.prisma.customer.findMany({
      where: {
        business_id: businessId,
        current_due: { gt: 0 },
        deleted_at: null,
      },
      include: {
        sales: {
          where: {
            due_amount: { gt: 0 },
            status: { in: ['DUE', 'PARTIALLY_PAID'] },
          },
          select: {
            sale_date: true,
            due_amount: true,
          },
          orderBy: { sale_date: 'desc' },
        },
      },
    });

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    const report = customers.map((c) => {
      let bucket0_30 = new Prisma.Decimal(0);
      let bucket31_60 = new Prisma.Decimal(0);
      let bucket61_90 = new Prisma.Decimal(0);
      let bucket90Plus = new Prisma.Decimal(0);

      for (const sale of c.sales) {
        const days = Math.floor((now - new Date(sale.sale_date).getTime()) / dayMs);
        const due = new Prisma.Decimal(sale.due_amount);

        if (days <= 30) {
          bucket0_30 = bucket0_30.plus(due);
        } else if (days <= 60) {
          bucket31_60 = bucket31_60.plus(due);
        } else if (days <= 90) {
          bucket61_90 = bucket61_90.plus(due);
        } else {
          bucket90Plus = bucket90Plus.plus(due);
        }
      }

      // Any current_due not accounted by specific sales goes to 90+ (e.g. opening due)
      const sumSalesDue = bucket0_30.plus(bucket31_60).plus(bucket61_90).plus(bucket90Plus);
      const customerTotalDue = new Prisma.Decimal(c.current_due);
      if (customerTotalDue.greaterThan(sumSalesDue)) {
        bucket90Plus = bucket90Plus.plus(customerTotalDue.minus(sumSalesDue));
      }

      const lastPurchaseDate = c.sales.length > 0 ? c.sales[0].sale_date : null;

      return {
        customerId: c.id,
        name: c.name,
        phone: c.phone,
        currentDue: customerTotalDue.toString(),
        lastPurchaseDate,
        agingBuckets: {
          days0_30: bucket0_30.toString(),
          days31_60: bucket31_60.toString(),
          days61_90: bucket61_90.toString(),
          days90Plus: bucket90Plus.toString(),
        },
      };
    });

    return report;
  }

  /**
   * Report: Per-branch due split (grouped by branch from Sale.due_amount).
   */
  async getBranchDueSplitReport(businessId: string) {
    const branches = await this.prisma.branch.findMany({
      where: { business_id: businessId, is_active: true },
      select: { id: true, name: true, code: true },
    });

    const salesWithDue = await this.prisma.sale.groupBy({
      by: ['branch_id'],
      where: {
        business_id: businessId,
        due_amount: { gt: 0 },
        status: { in: ['DUE', 'PARTIALLY_PAID'] },
      },
      _sum: {
        due_amount: true,
      },
      _count: {
        id: true,
      },
    });

    const dueMap = new Map(
      salesWithDue.map((s) => [
        s.branch_id,
        {
          totalDue: s._sum.due_amount?.toString() || '0',
          dueSalesCount: s._count.id,
        },
      ]),
    );

    return branches.map((b) => ({
      branchId: b.id,
      name: b.name,
      code: b.code,
      totalDue: dueMap.get(b.id)?.totalDue || '0',
      dueSalesCount: dueMap.get(b.id)?.dueSalesCount || 0,
    }));
  }
}
