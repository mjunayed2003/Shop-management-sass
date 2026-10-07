import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  ProfitReportQueryDto,
  CollectionsSummaryQueryDto,
} from '../dto/report.dto.js';
import { Prisma } from '../../../generated/prisma/client.js';

@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Profit & Loss report per branch and combined for business.
   * Excludes VOIDED sales. Subtracts returns and returned costs.
   */
  async getProfitReport(
    businessId: string,
    currentBranchId: string,
    isAllBranchAdmin: boolean,
    query: ProfitReportQueryDto,
  ) {
    const branches = await this.prisma.branch.findMany({
      where: {
        business_id: businessId,
        is_active: true,
        ...(isAllBranchAdmin
          ? query.branchId ? { id: query.branchId } : {}
          : { id: currentBranchId }),
      },
      select: { id: true, name: true, code: true },
    });

    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (query.startDate) {
      dateFilter.gte = new Date(query.startDate);
    }
    if (query.endDate) {
      const end = new Date(query.endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }

    const branchReports = await Promise.all(
      branches.map(async (b) => {
        // 1. Sales (excluding VOIDED)
        const sales = await this.prisma.sale.findMany({
          where: {
            business_id: businessId,
            branch_id: b.id,
            status: { not: 'VOIDED' },
            ...(query.startDate || query.endDate ? { sale_date: dateFilter } : {}),
          },
          select: {
            subtotal: true,
            discount_amount: true,
            total_amount: true,
            total_cost: true,
          },
        });

        let grossSales = new Prisma.Decimal(0);
        let discounts = new Prisma.Decimal(0);
        let saleCogs = new Prisma.Decimal(0);

        for (const s of sales) {
          grossSales = grossSales.plus(new Prisma.Decimal(s.subtotal));
          discounts = discounts.plus(new Prisma.Decimal(s.discount_amount));
          saleCogs = saleCogs.plus(new Prisma.Decimal(s.total_cost));
        }

        // 2. Sales Returns
        const returns = await this.prisma.salesReturn.findMany({
          where: {
            business_id: businessId,
            branch_id: b.id,
            ...(query.startDate || query.endDate ? { created_at: dateFilter } : {}),
          },
          include: {
            items: true,
          },
        });

        let salesReturns = new Prisma.Decimal(0);
        let returnedCost = new Prisma.Decimal(0);

        for (const ret of returns) {
          salesReturns = salesReturns.plus(new Prisma.Decimal(ret.total_refund_amount));
          for (const item of ret.items) {
            returnedCost = returnedCost.plus(
              new Prisma.Decimal(item.quantity).times(item.unit_cost),
            );
          }
        }

        // 3. Damaged Stock Losses
        const damages = await this.prisma.damagedStock.findMany({
          where: {
            business_id: businessId,
            branch_id: b.id,
            ...(query.startDate || query.endDate ? { created_at: dateFilter } : {}),
          },
          select: { total_loss: true },
        });

        let damageLoss = new Prisma.Decimal(0);
        for (const dmg of damages) {
          damageLoss = damageLoss.plus(new Prisma.Decimal(dmg.total_loss));
        }

        // 4. Expenses
        const expenses = await this.prisma.expense.findMany({
          where: {
            business_id: businessId,
            branch_id: b.id,
            ...(query.startDate || query.endDate ? { expense_date: dateFilter } : {}),
          },
          select: { total_amount: true },
        });

        let totalExpenses = new Prisma.Decimal(0);
        for (const exp of expenses) {
          totalExpenses = totalExpenses.plus(new Prisma.Decimal(exp.total_amount));
        }

        // 5. Computed Profit Metrics
        const netSales = grossSales.minus(discounts).minus(salesReturns);
        const costOfGoodsSold = saleCogs.minus(returnedCost);
        const grossProfit = netSales.minus(costOfGoodsSold);
        const netProfit = grossProfit.minus(totalExpenses);

        return {
          branchId: b.id,
          branchName: b.name,
          branchCode: b.code,
          grossSales: grossSales.toString(),
          discounts: discounts.toString(),
          salesReturns: salesReturns.toString(),
          netSales: netSales.toString(),
          costOfGoodsSold: costOfGoodsSold.toString(),
          grossProfit: grossProfit.toString(),
          expenses: totalExpenses.toString(),
          damageLoss: damageLoss.toString(),
          netProfit: netProfit.toString(),
        };
      }),
    );

    // Compute combined total
    const combinedTotal = branchReports.reduce(
      (acc, r) => ({
        grossSales: new Prisma.Decimal(acc.grossSales).plus(r.grossSales).toString(),
        discounts: new Prisma.Decimal(acc.discounts).plus(r.discounts).toString(),
        salesReturns: new Prisma.Decimal(acc.salesReturns).plus(r.salesReturns).toString(),
        netSales: new Prisma.Decimal(acc.netSales).plus(r.netSales).toString(),
        costOfGoodsSold: new Prisma.Decimal(acc.costOfGoodsSold).plus(r.costOfGoodsSold).toString(),
        grossProfit: new Prisma.Decimal(acc.grossProfit).plus(r.grossProfit).toString(),
        expenses: new Prisma.Decimal(acc.expenses).plus(r.expenses).toString(),
        damageLoss: new Prisma.Decimal(acc.damageLoss).plus(r.damageLoss).toString(),
        netProfit: new Prisma.Decimal(acc.netProfit).plus(r.netProfit).toString(),
      }),
      {
        grossSales: '0',
        discounts: '0',
        salesReturns: '0',
        netSales: '0',
        costOfGoodsSold: '0',
        grossProfit: '0',
        expenses: '0',
        damageLoss: '0',
        netProfit: '0',
      },
    );

    if (!isAllBranchAdmin) {
      return branchReports[0];
    }

    return {
      branches: branchReports,
      combinedTotal,
    };
  }

  /**
   * Collections Summary report: cash, bkash, nagad, bank, etc.
   * (Sales payments + due collections - refunds) per branch per day.
   */
  async getCollectionsSummary(
    businessId: string,
    currentBranchId: string,
    isAllBranchAdmin: boolean,
    query: CollectionsSummaryQueryDto,
  ) {
    const branches = await this.prisma.branch.findMany({
      where: {
        business_id: businessId,
        is_active: true,
        ...(isAllBranchAdmin
          ? query.branchId ? { id: query.branchId } : {}
          : { id: currentBranchId }),
      },
      select: { id: true, name: true, code: true },
    });

    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (query.startDate) {
      dateFilter.gte = new Date(query.startDate);
    }
    if (query.endDate) {
      const end = new Date(query.endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }

    const branchCollections = await Promise.all(
      branches.map(async (b) => {
        // 1. Sale Payments
        const payments = await this.prisma.salePayment.findMany({
          where: {
            business_id: businessId,
            branch_id: b.id,
            ...(query.startDate || query.endDate ? { payment_date: dateFilter } : {}),
          },
        });

        // 2. Due Collections
        const dues = await this.prisma.dueCollection.findMany({
          where: {
            business_id: businessId,
            branch_id: b.id,
            ...(query.startDate || query.endDate ? { receipt_date: dateFilter } : {}),
          },
        });

        // 3. Sales Returns
        const returns = await this.prisma.salesReturn.findMany({
          where: {
            business_id: businessId,
            branch_id: b.id,
            ...(query.startDate || query.endDate ? { created_at: dateFilter } : {}),
          },
        });

        const tenderTotals: Record<string, { collected: Prisma.Decimal; refunded: Prisma.Decimal; net: Prisma.Decimal }> = {
          CASH: { collected: new Prisma.Decimal(0), refunded: new Prisma.Decimal(0), net: new Prisma.Decimal(0) },
          BKASH: { collected: new Prisma.Decimal(0), refunded: new Prisma.Decimal(0), net: new Prisma.Decimal(0) },
          NAGAD: { collected: new Prisma.Decimal(0), refunded: new Prisma.Decimal(0), net: new Prisma.Decimal(0) },
          BANK: { collected: new Prisma.Decimal(0), refunded: new Prisma.Decimal(0), net: new Prisma.Decimal(0) },
          CARDS: { collected: new Prisma.Decimal(0), refunded: new Prisma.Decimal(0), net: new Prisma.Decimal(0) },
          CHEQUE: { collected: new Prisma.Decimal(0), refunded: new Prisma.Decimal(0), net: new Prisma.Decimal(0) },
        };

        for (const p of payments) {
          const m = p.payment_method;
          if (!tenderTotals[m]) {
            tenderTotals[m] = { collected: new Prisma.Decimal(0), refunded: new Prisma.Decimal(0), net: new Prisma.Decimal(0) };
          }
          tenderTotals[m].collected = tenderTotals[m].collected.plus(new Prisma.Decimal(p.amount));
        }

        for (const d of dues) {
          const m = d.payment_method;
          if (!tenderTotals[m]) {
            tenderTotals[m] = { collected: new Prisma.Decimal(0), refunded: new Prisma.Decimal(0), net: new Prisma.Decimal(0) };
          }
          tenderTotals[m].collected = tenderTotals[m].collected.plus(new Prisma.Decimal(d.amount));
        }

        for (const r of returns) {
          const m = r.refund_method;
          if (m && tenderTotals[m]) {
            tenderTotals[m].refunded = tenderTotals[m].refunded.plus(new Prisma.Decimal(r.total_refund_amount));
          }
        }

        let totalNet = new Prisma.Decimal(0);
        const tendersResult: Record<string, { collected: string; refunded: string; net: string }> = {};

        for (const [key, val] of Object.entries(tenderTotals)) {
          const net = val.collected.minus(val.refunded);
          totalNet = totalNet.plus(net);
          tendersResult[key] = {
            collected: val.collected.toString(),
            refunded: val.refunded.toString(),
            net: net.toString(),
          };
        }

        return {
          branchId: b.id,
          branchName: b.name,
          tenders: tendersResult,
          totalNetCollections: totalNet.toString(),
        };
      }),
    );

    if (!isAllBranchAdmin) {
      return branchCollections[0];
    }

    return branchCollections;
  }
}
