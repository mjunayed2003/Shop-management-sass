import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  PlatformInvoiceStatus,
  PlatformPaymentMethod,
  Prisma,
} from '../../../generated/prisma/client.js';
import { SubscriptionService } from '../../subscription/services/subscription.service.js';

@Injectable()
export class PlatformInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  async listInvoices(query: {
    page?: number;
    limit?: number;
    status?: PlatformInvoiceStatus;
    businessId?: string;
  }) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.businessId) where.business_id = query.businessId;

    const [invoices, total] = await Promise.all([
      this.prisma.subscriptionInvoice.findMany({
        where,
        include: {
          business: { select: { id: true, name: true, slug: true, email: true } },
          plan: { select: { name: true, code: true } },
          payments: true,
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.subscriptionInvoice.count({ where }),
    ]);

    return {
      data: invoices,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async voidInvoice(invoiceId: string) {
    const invoice = await this.prisma.subscriptionInvoice.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice) {
      throw new NotFoundException('Subscription invoice not found.');
    }
    if (invoice.status === PlatformInvoiceStatus.PAID) {
      throw new BadRequestException('Cannot void an invoice that has already been paid.');
    }

    return this.prisma.subscriptionInvoice.update({
      where: { id: invoiceId },
      data: { status: PlatformInvoiceStatus.VOID },
    });
  }

  async markOverdue(invoiceId: string) {
    const invoice = await this.prisma.subscriptionInvoice.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice) {
      throw new NotFoundException('Subscription invoice not found.');
    }
    if (invoice.status === PlatformInvoiceStatus.PAID || invoice.status === PlatformInvoiceStatus.VOID) {
      throw new BadRequestException(`Cannot mark invoice as overdue from status "${invoice.status}".`);
    }

    return this.prisma.subscriptionInvoice.update({
      where: { id: invoiceId },
      data: { status: PlatformInvoiceStatus.OVERDUE },
    });
  }

  async recordPayment(
    invoiceId: string,
    amount: number,
    paymentMethod: PlatformPaymentMethod,
    transactionId?: string,
  ) {
    return this.subscriptionService.recordPayment(
      invoiceId,
      amount,
      paymentMethod,
      transactionId,
    );
  }

  async getRevenueSummary() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // 1. Collected this month
    const paymentsThisMonth = await this.prisma.platformPayment.aggregate({
      where: {
        paid_at: { gte: startOfMonth },
        status: PlatformInvoiceStatus.PAID,
      },
      _sum: { amount: true },
    });

    // 2. Overdue amount
    const overdueInvoices = await this.prisma.subscriptionInvoice.aggregate({
      where: { status: PlatformInvoiceStatus.OVERDUE },
      _sum: { net_amount: true },
    });

    // 3. MRR estimate (sum of active subscriptions' monthly equivalent)
    const activeSubs = await this.prisma.subscription.findMany({
      where: { status: 'ACTIVE' },
      include: { plan: true },
    });

    let mrr = new Prisma.Decimal(0);
    for (const sub of activeSubs) {
      if (sub.billing_cycle === 'YEARLY') {
        mrr = mrr.plus(new Prisma.Decimal(sub.plan.yearly_price).dividedBy(12));
      } else {
        mrr = mrr.plus(new Prisma.Decimal(sub.plan.monthly_price));
      }
    }

    return {
      collectedThisMonth: paymentsThisMonth._sum.amount ? Number(paymentsThisMonth._sum.amount) : 0,
      overdueAmount: overdueInvoices._sum.net_amount ? Number(overdueInvoices._sum.net_amount) : 0,
      mrrEstimate: mrr.toDecimalPlaces(2).toNumber(),
      activeSubscriptionsCount: activeSubs.length,
    };
  }
}
