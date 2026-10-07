import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  Prisma,
  SubscriptionStatus,
  BillingCycle,
  PlatformInvoiceStatus,
} from '../../../generated/prisma/client.js';
import { PlatformSequenceService } from './platform-sequence.service.js';

@Injectable()
export class SubscriptionBillingService {
  private readonly logger = new Logger(SubscriptionBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sequenceService: PlatformSequenceService,
  ) {}

  /**
   * Daily billing job that evaluates subscription lifecycles, advances statuses,
   * generates period invoices idempotently, and moves subscriptions into GRACE / SUSPENDED.
   */
  async processDailyBillingCycle(): Promise<{
    invoicesIssued: number;
    subscriptionsUpdated: number;
    suspended: number;
  }> {
    const now = new Date();
    let invoicesIssued = 0;
    let subscriptionsUpdated = 0;
    let suspended = 0;

    // Get configurable grace days (default 7)
    let graceDays = 7;
    const graceSetting = await this.prisma.systemSetting.findUnique({
      where: { key: 'subscription_grace_days' },
    });
    if (graceSetting && !isNaN(parseInt(graceSetting.value, 10))) {
      graceDays = parseInt(graceSetting.value, 10);
    }

    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        status: {
          in: [
            SubscriptionStatus.TRIAL,
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.PAYMENT_DUE,
            SubscriptionStatus.GRACE,
          ],
        },
      },
      include: {
        plan: true,
        business: true,
      },
    });

    for (const sub of subscriptions) {
      try {
        const overrides = await this.prisma.subscriptionOverride.findMany({
          where: {
            business_id: sub.business_id,
            OR: [{ valid_until: null }, { valid_until: { gt: now } }],
          },
        });

        const isFree = sub.is_free_access || overrides.some((o) => o.is_free_access);

        // 1. Check if trial has ended
        if (sub.status === SubscriptionStatus.TRIAL) {
          // Check if trial extension exists
          const extensionDays = overrides.reduce(
            (max, o) => Math.max(max, o.trial_extended_days || 0),
            0,
          );
          const effectiveTrialEnd = new Date(sub.trial_ends_at);
          if (extensionDays > 0) {
            effectiveTrialEnd.setDate(effectiveTrialEnd.getDate() + extensionDays);
          }

          if (now >= effectiveTrialEnd) {
            if (isFree) {
              await this.prisma.subscription.update({
                where: { id: sub.id },
                data: { status: SubscriptionStatus.ACTIVE },
              });
              subscriptionsUpdated++;
            } else {
              // Transition to PAYMENT_DUE and issue first invoice
              const graceEnd = new Date(now.getTime() + graceDays * 24 * 60 * 60 * 1000);
              await this.prisma.subscription.update({
                where: { id: sub.id },
                data: {
                  status: SubscriptionStatus.PAYMENT_DUE,
                  grace_ends_at: graceEnd,
                },
              });
              subscriptionsUpdated++;

              const issued = await this.issuePeriodInvoice(sub, overrides, now);
              if (issued) invoicesIssued++;
            }
          }
          continue;
        }

        // 2. Check ACTIVE subscriptions nearing or past period end
        if (sub.status === SubscriptionStatus.ACTIVE) {
          if (now >= sub.current_period_end) {
            if (isFree) {
              // Automatically roll forward without billing
              const cycle = sub.billing_cycle;
              const nextEnd = new Date(sub.current_period_end);
              if (cycle === BillingCycle.YEARLY) {
                nextEnd.setFullYear(nextEnd.getFullYear() + 1);
              } else {
                nextEnd.setMonth(nextEnd.getMonth() + 1);
              }
              await this.prisma.subscription.update({
                where: { id: sub.id },
                data: {
                  current_period_start: sub.current_period_end,
                  current_period_end: nextEnd,
                },
              });
              subscriptionsUpdated++;
            } else {
              // Move to GRACE / PAYMENT_DUE, set grace end date, issue next invoice
              const graceEnd = new Date(now.getTime() + graceDays * 24 * 60 * 60 * 1000);
              await this.prisma.subscription.update({
                where: { id: sub.id },
                data: {
                  status: SubscriptionStatus.GRACE,
                  grace_ends_at: graceEnd,
                },
              });
              subscriptionsUpdated++;

              const issued = await this.issuePeriodInvoice(sub, overrides, now);
              if (issued) invoicesIssued++;
            }
          }
          continue;
        }

        // 3. Check PAYMENT_DUE or GRACE subscriptions that exceeded grace period
        if (
          sub.status === SubscriptionStatus.PAYMENT_DUE ||
          sub.status === SubscriptionStatus.GRACE
        ) {
          if (sub.grace_ends_at && now >= sub.grace_ends_at) {
            await this.prisma.subscription.update({
              where: { id: sub.id },
              data: { status: SubscriptionStatus.SUSPENDED },
            });
            suspended++;
          }
        }
      } catch (err: any) {
        this.logger.error(`Error processing billing for subscription ${sub.id}: ${err.message}`);
      }
    }

    return { invoicesIssued, subscriptionsUpdated, suspended };
  }

  /**
   * Idempotently issues an invoice for the upcoming period.
   * Guarded by subscription_id + billing_start.
   */
  async issuePeriodInvoice(
    sub: any,
    overrides: any[],
    periodStart: Date,
  ): Promise<boolean> {
    const cycle = sub.billing_cycle;
    const periodEnd = new Date(periodStart);
    if (cycle === BillingCycle.YEARLY) {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    // Idempotency check: see if invoice already exists covering this period
    const existing = await this.prisma.subscriptionInvoice.findFirst({
      where: {
        subscription_id: sub.id,
        billing_start: periodStart,
        billing_end: periodEnd,
      },
    });

    if (existing) {
      return false; // Already issued
    }

    // Determine price
    let basePrice: Prisma.Decimal;
    const activeCustomPrice =
      cycle === BillingCycle.YEARLY
        ? overrides.find((o) => o.custom_yearly_price !== null)?.custom_yearly_price
        : overrides.find((o) => o.custom_monthly_price !== null)?.custom_monthly_price;

    if (activeCustomPrice) {
      basePrice = new Prisma.Decimal(activeCustomPrice);
    } else {
      basePrice =
        cycle === BillingCycle.YEARLY
          ? new Prisma.Decimal(sub.plan.yearly_price)
          : new Prisma.Decimal(sub.plan.monthly_price);
    }

    // Discount percentage if present
    const maxDiscountPct = overrides.reduce(
      (max, o) => Math.max(max, o.discount_percentage ? Number(o.discount_percentage) : 0),
      0,
    );

    const discountAmount =
      maxDiscountPct > 0
        ? basePrice.times(maxDiscountPct / 100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
        : new Prisma.Decimal(0);

    const netAmount = basePrice.minus(discountAmount);

    return this.prisma.$transaction(async (tx) => {
      // Re-check inside transaction with FOR UPDATE
      const dupCheck = await tx.subscriptionInvoice.findFirst({
        where: {
          subscription_id: sub.id,
          billing_start: periodStart,
          billing_end: periodEnd,
        },
      });
      if (dupCheck) return false;

      const invoiceNo = await this.sequenceService.getNextInvoiceNumber(tx);
      const dueDate = new Date(periodStart.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

      await tx.subscriptionInvoice.create({
        data: {
          invoice_no: invoiceNo,
          business_id: sub.business_id,
          subscription_id: sub.id,
          plan_id: sub.plan_id,
          amount: basePrice,
          discount_amount: discountAmount,
          net_amount: netAmount,
          status: PlatformInvoiceStatus.ISSUED,
          billing_start: periodStart,
          billing_end: periodEnd,
          due_date: dueDate,
        },
      });

      return true;
    });
  }
}
