import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sanitizes a cell value against CSV formula injection (DDE attacks).
   * Prefixes cells starting with '=', '+', '-', or '@' with a single quote.
   */
  sanitizeCell(val: any): string {
    if (val === null || val === undefined) return '';
    let str = String(val);

    // Escape formula injection
    if (/^[=+\-@\t\r]/.test(str)) {
      str = `'${str}`;
    }

    // Escape quotes for CSV
    if (str.includes('"') || str.includes(',') || str.includes('\n')) {
      str = `"${str.replace(/"/g, '""')}"`;
    }

    return str;
  }

  toCsv(headers: string[], rows: any[][]): string {
    const headerLine = headers.map((h) => this.sanitizeCell(h)).join(',');
    const bodyLines = rows.map((r) => r.map((c) => this.sanitizeCell(c)).join(','));
    return [headerLine, ...bodyLines].join('\n');
  }

  async exportSales(businessId: string, branchId?: string, isOwner = false): Promise<string> {
    const where: any = { business_id: businessId };
    if (!isOwner && branchId) where.branch_id = branchId;

    const sales = await this.prisma.sale.findMany({
      where,
      include: { customer: true, branch: true },
      orderBy: { created_at: 'desc' },
      take: 5000,
    });

    const headers = ['Invoice No', 'Date', 'Branch', 'Customer', 'Status', 'Total', 'Paid', 'Due'];
    const rows = sales.map((s) => [
      s.invoice_no,
      s.sale_date.toISOString(),
      s.branch.name,
      s.customer?.name || 'Walk-in',
      s.status,
      Number(s.total_amount),
      Number(s.paid_amount),
      Number(s.due_amount),
    ]);

    return this.toCsv(headers, rows);
  }

  async exportStock(businessId: string, branchId?: string, isOwner = false): Promise<string> {
    const where: any = { business_id: businessId };
    if (!isOwner && branchId) where.branch_id = branchId;

    const balances = await this.prisma.stockBalance.findMany({
      where,
      include: {
        variant: { include: { product: true } },
        branch: true,
      },
      take: 5000,
    });

    const headers = ['SKU', 'Product Name', 'Branch', 'Quantity', 'Avg Cost', 'Total Value'];
    const rows = balances.map((b) => [
      b.variant.sku,
      b.variant.product.name,
      b.branch.name,
      Number(b.quantity),
      Number(b.avg_cost_price),
      Number(b.total_cost_value),
    ]);

    return this.toCsv(headers, rows);
  }

  async exportExpenses(businessId: string, branchId?: string, isOwner = false): Promise<string> {
    const where: any = { business_id: businessId };
    if (!isOwner && branchId) where.branch_id = branchId;

    const expenses = await this.prisma.expense.findMany({
      where,
      include: { category: true, branch: true },
      take: 5000,
    });

    const headers = ['Expense No', 'Date', 'Branch', 'Category', 'Vendor', 'Amount', 'Tax', 'Total'];
    const rows = expenses.map((e) => [
      e.expense_no,
      e.expense_date.toISOString(),
      e.branch.name,
      e.category.name,
      e.vendor_name || 'N/A',
      Number(e.amount),
      Number(e.tax_amount),
      Number(e.total_amount),
    ]);

    return this.toCsv(headers, rows);
  }

  async exportCustomerDue(businessId: string): Promise<string> {
    const customers = await this.prisma.customer.findMany({
      where: { business_id: businessId, deleted_at: null, current_due: { gt: 0 } },
      orderBy: { current_due: 'desc' },
      take: 5000,
    });

    const headers = ['Customer Name', 'Phone', 'Email', 'Current Due', 'Credit Limit'];
    const rows = customers.map((c) => [
      c.name,
      c.phone,
      c.email || '',
      Number(c.current_due),
      Number(c.credit_limit),
    ]);

    return this.toCsv(headers, rows);
  }

  async exportSmsLogs(businessId: string, branchId?: string, isOwner = false): Promise<string> {
    const where: any = { business_id: businessId };
    if (!isOwner && branchId) where.branch_id = branchId;

    const logs = await this.prisma.smsLog.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: 5000,
    });

    const headers = ['Date', 'Phone', 'Purpose', 'Status', 'Cost', 'Message'];
    const rows = logs.map((l) => [
      l.created_at.toISOString(),
      l.recipient_phone,
      l.purpose,
      l.status,
      Number(l.cost),
      l.message_body,
    ]);

    return this.toCsv(headers, rows);
  }

  async exportAuditLogs(businessId: string, branchId?: string, isOwner = false): Promise<string> {
    const where: any = { business_id: businessId };
    if (!isOwner && branchId) where.branch_id = branchId;

    const logs = await this.prisma.auditLog.findMany({
      where,
      include: { user: true },
      orderBy: { created_at: 'desc' },
      take: 5000,
    });

    const headers = ['Timestamp', 'User', 'Action', 'Entity Table', 'Entity ID', 'IP Address'];
    const rows = logs.map((l) => [
      l.created_at.toISOString(),
      l.user ? `${l.user.first_name} ${l.user.last_name}` : 'System',
      l.action,
      l.entity_table,
      l.entity_id,
      l.ip_address || '',
    ]);

    return this.toCsv(headers, rows);
  }
}
