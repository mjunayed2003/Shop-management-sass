import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  Prisma,
  SubscriptionStatus,
  BillingCycle,
  PlatformInvoiceStatus,
  PlatformPaymentMethod,
} from '../../../generated/prisma/client.js';
import { PlatformSequenceService } from './platform-sequence.service.js';
import { PlanLimitService } from './plan-limit.service.js';

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequenceService: PlatformSequenceService,
    private readonly planLimitService: PlanLimitService,
  ) {}

  async getCurrentSubscription(businessId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { business_id: businessId },
      include: {
        plan: {
          include: { limits: true },
        },
      },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found for this business.');
    }

    const { limits, usage } = await this.planLimitService.getUsageAndLimits(businessId);

    const now = new Date();
    const activeOverrides = await this.prisma.subscriptionOverride.findMany({
      where: {
        business_id: businessId,
        OR: [{ valid_until: null }, { valid_until: { gt: now } }],
      },
      select: {
        id: true,
        custom_monthly_price: true,
        custom_yearly_price: true,
        discount_percentage: true,
        is_free_access: true,
        trial_extended_days: true,
        valid_until: true,
        reason: true,
      },
    });

    return {
      subscription: {
        id: subscription.id,
        status: subscription.status,
        billingCycle: subscription.billing_cycle,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
        trialStartsAt: subscription.trial_starts_at,
        trialEndsAt: subscription.trial_ends_at,
        graceEndsAt: subscription.grace_ends_at,
        isFreeAccess: subscription.is_free_access,
        plan: {
          id: subscription.plan.id,
          name: subscription.plan.name,
          code: subscription.plan.code,
          monthlyPrice: subscription.plan.monthly_price,
          yearlyPrice: subscription.plan.yearly_price,
        },
      },
      effectiveLimits: limits,
      usage,
      activeOverrides,
    };
  }

  async getInvoices(businessId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [invoices, total] = await Promise.all([
      this.prisma.subscriptionInvoice.findMany({
        where: { business_id: businessId },
        include: {
          plan: { select: { name: true, code: true } },
          payments: true,
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.subscriptionInvoice.count({
        where: { business_id: businessId },
      }),
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

  async getInvoiceDetail(businessId: string, invoiceId: string) {
    const invoice = await this.prisma.subscriptionInvoice.findFirst({
      where: {
        id: invoiceId,
        business_id: businessId,
      },
      include: {
        plan: true,
        payments: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException('Subscription invoice not found.');
    }

    return invoice;
  }

  async getPaymentHistory(businessId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [payments, total] = await Promise.all([
      this.prisma.platformPayment.findMany({
        where: { business_id: businessId },
        include: {
          invoice: {
            select: { invoice_no: true, net_amount: true, status: true },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.platformPayment.count({
        where: { business_id: businessId },
      }),
    ]);

    return {
      data: payments,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async upgradePlan(businessId: string, targetPlanId: string, billingCycle?: BillingCycle) {
    const currentSub = await this.prisma.subscription.findUnique({
      where: { business_id: businessId },
      include: { plan: true },
    });

    if (!currentSub) {
      throw new NotFoundException('Subscription not found.');
    }

    const targetPlan = await this.prisma.plan.findUnique({
      where: { id: targetPlanId },
      include: { limits: true },
    });

    if (!targetPlan || !targetPlan.is_active) {
      throw new BadRequestException('Target plan not found or is currently inactive.');
    }

    const cycle = billingCycle || currentSub.billing_cycle;
    const price = cycle === BillingCycle.YEARLY ? targetPlan.yearly_price : targetPlan.monthly_price;

    return this.prisma.$transaction(async (tx) => {
      // 1. Update subscription plan reference
      const updated = await tx.subscription.update({
        where: { id: currentSub.id },
        data: {
          plan_id: targetPlan.id,
          billing_cycle: cycle,
        },
      });

      // 2. Generate immediate invoice for the upgrade
      const invoiceNo = await this.sequenceService.getNextInvoiceNumber(tx);
      const now = new Date();
      const nextEnd = new Date(now);
      if (cycle === BillingCycle.YEARLY) {
        nextEnd.setFullYear(nextEnd.getFullYear() + 1);
      } else {
        nextEnd.setMonth(nextEnd.getMonth() + 1);
      }

      const invoice = await tx.subscriptionInvoice.create({
        data: {
          invoice_no: invoiceNo,
          business_id: businessId,
          subscription_id: currentSub.id,
          plan_id: targetPlan.id,
          amount: price,
          discount_amount: new Prisma.Decimal(0),
          net_amount: price,
          status: PlatformInvoiceStatus.ISSUED,
          billing_start: now,
          billing_end: nextEnd,
          due_date: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), // 7 days
        },
      });

      return {
        message: `Plan upgraded to ${targetPlan.name}. An invoice has been issued.`,
        subscription: updated,
        invoice,
      };
    });
  }

  async cancelSubscription(businessId: string, reason?: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { business_id: businessId },
    });

    if (!sub) {
      throw new NotFoundException('Subscription not found.');
    }

    const updated = await this.prisma.subscription.update({
      where: { id: sub.id },
      data: {
        status: SubscriptionStatus.CANCELLED,
        cancelled_at: new Date(),
      },
    });

    return {
      message: 'Subscription has been cancelled.',
      subscription: updated,
    };
  }

  /**
   * Records a payment against an invoice (Super Admin or Gateway Webhook)
   */
  async recordPayment(
    invoiceId: string,
    amount: number | Prisma.Decimal,
    paymentMethod: PlatformPaymentMethod,
    transactionId?: string,
    providerRef?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.subscriptionInvoice.findUnique({
        where: { id: invoiceId },
        include: { subscription: true, payments: true },
      });

      if (!invoice) {
        throw new NotFoundException('Invoice not found.');
      }

      if (invoice.status === PlatformInvoiceStatus.PAID) {
        return { message: 'Invoice is already fully paid.', invoice };
      }

      const payAmount = new Prisma.Decimal(amount);
      if (payAmount.lessThanOrEqualTo(0)) {
        throw new BadRequestException('Payment amount must be greater than zero.');
      }

      // Check idempotency on provider_ref if present
      if (providerRef) {
        const existing = await tx.platformPayment.findFirst({
          where: { provider_ref: providerRef },
        });
        if (existing) {
          return { message: 'Payment already processed with this provider reference.', invoice };
        }
      }

      // 1. Create payment record
      const payment = await tx.platformPayment.create({
        data: {
          invoice_id: invoice.id,
          business_id: invoice.business_id,
          amount: payAmount,
          payment_method: paymentMethod,
          transaction_id: transactionId || null,
          provider_ref: providerRef || null,
          status: PlatformInvoiceStatus.PAID,
          paid_at: new Date(),
        },
      });

      // 2. Sum all payments on invoice
      const totalPaid = invoice.payments
        .reduce((acc, p) => acc.plus(new Prisma.Decimal(p.amount)), new Prisma.Decimal(0))
        .plus(payAmount);

      let invoiceStatus: PlatformInvoiceStatus = invoice.status;
      if (totalPaid.greaterThanOrEqualTo(new Prisma.Decimal(invoice.net_amount))) {
        invoiceStatus = PlatformInvoiceStatus.PAID;

        await tx.subscriptionInvoice.update({
          where: { id: invoice.id },
          data: {
            status: PlatformInvoiceStatus.PAID,
            paid_at: new Date(),
          },
        });

        // 3. Activate subscription & clear grace
        const now = new Date();
        const cycle = invoice.subscription.billing_cycle;
        const newPeriodEnd = new Date(now);
        if (cycle === BillingCycle.YEARLY) {
          newPeriodEnd.setFullYear(newPeriodEnd.getFullYear() + 1);
        } else {
          newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);
        }

        await tx.subscription.update({
          where: { id: invoice.subscription_id },
          data: {
            status: SubscriptionStatus.ACTIVE,
            current_period_start: now,
            current_period_end: newPeriodEnd,
            grace_ends_at: null,
          },
        });
      }

      return {
        payment,
        invoiceStatus,
        totalPaid: totalPaid.toNumber(),
        netAmount: invoice.net_amount.toNumber(),
      };
    });
  }
}
