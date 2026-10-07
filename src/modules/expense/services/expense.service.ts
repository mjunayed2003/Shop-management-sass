import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { SequenceService } from '../../inventory/services/sequence.service.js';
import { RegisterSessionService } from '../../sales/services/register-session.service.js';
import { LocalDiskFileStorageService } from './file-storage.service.js';
import {
  CreateExpenseDto,
  UpdateExpenseDto,
  ExpenseQueryDto,
} from '../dto/expense.dto.js';
import { Prisma } from '../../../generated/prisma/client.js';

export interface UserRoleContext {
  code: string;
  name: string;
  permissions: string[];
}

@Injectable()
export class ExpenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequenceService: SequenceService,
    private readonly registerSessionService: RegisterSessionService,
    private readonly fileStorageService: LocalDiskFileStorageService,
  ) {}

  /**
   * Creates an Expense record.
   * Server computes total_amount = amount + tax_amount.
   * If paid_from_register: enforces CASH and validates active OPEN session.
   */
  async createExpense(
    businessId: string,
    branchId: string,
    userId: string,
    dto: CreateExpenseDto,
    userRole?: UserRoleContext,
  ) {
    const amount = new Prisma.Decimal(dto.amount);
    const taxAmount = new Prisma.Decimal(dto.taxAmount || 0);
    const totalAmount = amount.plus(taxAmount);

    // Verify category belongs to business
    const category = await this.prisma.expenseCategory.findFirst({
      where: { id: dto.expenseCategoryId, business_id: businessId },
    });
    if (!category) {
      throw new NotFoundException(
        `Expense category "${dto.expenseCategoryId}" not found for this business.`,
      );
    }

    let registerSessionId: string | null = null;
    if (dto.paidFromRegister) {
      if (dto.paymentMethod && dto.paymentMethod.toUpperCase() !== 'CASH') {
        throw new BadRequestException(
          'paid_from_register is only valid when paymentMethod is CASH.',
        );
      }

      // Must have an active open session
      const session = await this.registerSessionService.validateActiveSession(
        businessId,
        branchId,
        userId,
      );
      registerSessionId = session.id;
    }

    // Optional business setting: expenses above threshold need expense.approve
    const approvalSetting = await this.prisma.systemSetting.findUnique({
      where: { key: 'expense_approval_threshold' },
    });
    const approvalThreshold = approvalSetting
      ? Number(approvalSetting.value)
      : null;

    let isApproved = true;
    if (approvalThreshold !== null && totalAmount.greaterThan(approvalThreshold)) {
      const hasApprovePerm =
        userRole?.permissions.includes('*') ||
        userRole?.permissions.includes('expenses:approve') ||
        userRole?.permissions.includes('expense.approve') ||
        userRole?.permissions.includes('expense:approve');

      if (!hasApprovePerm) {
        throw new ForbiddenException(
          `Expenses exceeding threshold of BDT ${approvalThreshold} require "expense.approve" permission.`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Generate expense_no atomically via InvoiceSequence (EXPENSE_VOUCHER)
      const expenseNo = await this.sequenceService.getNextNumber(
        tx,
        businessId,
        branchId,
        'EXPENSE_VOUCHER',
        'EXP-',
      );

      // 2. Create Expense record
      const expense = await tx.expense.create({
        data: {
          business_id: businessId,
          branch_id: branchId,
          expense_category_id: category.id,
          payment_account_id: null,
          register_session_id: registerSessionId,
          expense_no: expenseNo,
          amount,
          tax_amount: taxAmount,
          total_amount: totalAmount,
          expense_date: dto.expenseDate ? new Date(dto.expenseDate) : new Date(),
          vendor_name: dto.vendorName || null,
          receipt_no: dto.receiptNo || null,
          description: dto.description
            ? `[Method: ${dto.paymentMethod || 'CASH'}] ${dto.description}`
            : `[Method: ${dto.paymentMethod || 'CASH'}]`,
          created_by: userId,
        },
        include: {
          category: true,
        },
      });

      // 3. Attach file if provided
      if (dto.attachment) {
        const storedFile = await this.fileStorageService.saveFile({
          businessId,
          entityType: 'expense',
          entityId: expense.id,
          fileName: dto.attachment.fileName,
          mimeType: dto.attachment.mimeType,
          fileBuffer: dto.attachment.fileContentBase64
            ? Buffer.from(dto.attachment.fileContentBase64, 'base64')
            : undefined,
        });

        await tx.attachment.create({
          data: {
            business_id: businessId,
            entity_type: 'expense',
            entity_id: expense.id,
            file_name: storedFile.fileName,
            file_path: storedFile.filePath,
            file_size: storedFile.fileSize,
            mime_type: storedFile.mimeType,
            uploaded_by: userId,
          },
        });
      }

      // 4. Audit Log
      await tx.auditLog.create({
        data: {
          business_id: businessId,
          branch_id: branchId,
          user_id: userId,
          action: 'CREATE',
          entity_table: 'expenses',
          entity_id: expense.id,
          new_values: {
            expense_no: expenseNo,
            total_amount: totalAmount.toString(),
            paid_from_register: !!registerSessionId,
            register_session_id: registerSessionId,
            category: category.name,
            vendor: dto.vendorName,
          },
        },
      });

      return {
        ...expense,
        paid_from_register: !!registerSessionId,
      };
    });
  }

  /**
   * Update expense.
   * Edit only allowed while linked register session is OPEN (or no session linked),
   * otherwise requires "expense.update" permission + explicit reason.
   */
  async updateExpense(
    businessId: string,
    branchId: string,
    userId: string,
    expenseId: string,
    dto: UpdateExpenseDto,
    userRole?: UserRoleContext,
  ) {
    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, business_id: businessId, branch_id: branchId },
      include: { register_session: true },
    });

    if (!expense) {
      throw new NotFoundException(`Expense voucher "${expenseId}" not found in this branch.`);
    }

    // Check register session status
    if (expense.register_session_id && expense.register_session?.status === 'CLOSED') {
      const hasUpdatePerm =
        userRole?.permissions.includes('*') ||
        userRole?.permissions.includes('expense.update') ||
        userRole?.permissions.includes('expense:update') ||
        userRole?.permissions.includes('expenses:update');

      if (!hasUpdatePerm) {
        throw new ForbiddenException(
          'Cannot edit an expense linked to a closed register session without "expense.update" permission.',
        );
      }

      if (!dto.reason || dto.reason.trim().length === 0) {
        throw new BadRequestException(
          'A mandatory reason is required to update an expense linked to a closed register session.',
        );
      }
    }

    const newAmount =
      dto.amount !== undefined ? new Prisma.Decimal(dto.amount) : new Prisma.Decimal(expense.amount);
    const newTax =
      dto.taxAmount !== undefined ? new Prisma.Decimal(dto.taxAmount) : new Prisma.Decimal(expense.tax_amount);
    const newTotal = newAmount.plus(newTax);

    const oldValues = {
      amount: expense.amount.toString(),
      tax_amount: expense.tax_amount.toString(),
      total_amount: expense.total_amount.toString(),
      vendor_name: expense.vendor_name,
      description: expense.description,
    };

    const updated = await this.prisma.expense.update({
      where: { id: expenseId },
      data: {
        ...(dto.expenseCategoryId ? { expense_category_id: dto.expenseCategoryId } : {}),
        amount: newAmount,
        tax_amount: newTax,
        total_amount: newTotal,
        ...(dto.vendorName !== undefined ? { vendor_name: dto.vendorName } : {}),
        ...(dto.receiptNo !== undefined ? { receipt_no: dto.receiptNo } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
      },
    });

    // Write AuditLog
    await this.prisma.auditLog.create({
      data: {
        business_id: businessId,
        branch_id: branchId,
        user_id: userId,
        action: 'UPDATE',
        entity_table: 'expenses',
        entity_id: expenseId,
        old_values: oldValues,
        new_values: {
          amount: newAmount.toString(),
          tax_amount: newTax.toString(),
          total_amount: newTotal.toString(),
          vendor_name: updated.vendor_name,
          reason: dto.reason || null,
        },
      },
    });

    return updated;
  }

  /**
   * Delete expense with snapshot written to AuditLog (no soft-delete schema).
   */
  async deleteExpense(
    businessId: string,
    branchId: string,
    userId: string,
    expenseId: string,
  ) {
    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, business_id: businessId, branch_id: branchId },
      include: { category: true },
    });

    if (!expense) {
      throw new NotFoundException(`Expense "${expenseId}" not found in this branch.`);
    }

    // Write snapshot to AuditLog before deleting
    await this.prisma.auditLog.create({
      data: {
        business_id: businessId,
        branch_id: branchId,
        user_id: userId,
        action: 'DELETE',
        entity_table: 'expenses',
        entity_id: expenseId,
        old_values: {
          expense_no: expense.expense_no,
          total_amount: expense.total_amount.toString(),
          amount: expense.amount.toString(),
          category: expense.category.name,
          vendor: expense.vendor_name,
          description: expense.description,
          register_session_id: expense.register_session_id,
        },
      },
    });

    return this.prisma.expense.delete({
      where: { id: expenseId },
    });
  }

  /**
   * List expenses (branch-scoped, admin can view all).
   */
  async getExpenseList(
    businessId: string,
    branchId: string,
    query: ExpenseQueryDto,
    isAllBranchAdmin: boolean = false,
  ) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.ExpenseWhereInput = {
      business_id: businessId,
      ...(isAllBranchAdmin ? {} : { branch_id: branchId }),
      ...(query.categoryId ? { expense_category_id: query.categoryId } : {}),
      ...(query.startDate || query.endDate
        ? {
            expense_date: {
              ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
              ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
            },
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.expense.count({ where }),
      this.prisma.expense.findMany({
        where,
        skip,
        take: limit,
        orderBy: { expense_date: 'desc' },
        include: {
          category: true,
          branch: { select: { id: true, name: true, code: true } },
        },
      }),
    ]);

    return {
      items: items.map((i) => ({
        ...i,
        paid_from_register: !!i.register_session_id,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get single expense detail including attachments.
   */
  async getExpenseDetail(
    businessId: string,
    branchId: string,
    expenseId: string,
    isAllBranchAdmin: boolean = false,
  ) {
    const expense = await this.prisma.expense.findFirst({
      where: {
        id: expenseId,
        business_id: businessId,
        ...(isAllBranchAdmin ? {} : { branch_id: branchId }),
      },
      include: {
        category: true,
        branch: { select: { id: true, name: true, code: true } },
      },
    });

    if (!expense) {
      throw new NotFoundException(`Expense "${expenseId}" not found.`);
    }

    const attachments = await this.prisma.attachment.findMany({
      where: {
        business_id: businessId,
        entity_type: 'expense',
        entity_id: expenseId,
      },
    });

    return {
      ...expense,
      paid_from_register: !!expense.register_session_id,
      attachments,
    };
  }

  /**
   * Reports: expenses by category, day/month, branch, top vendors.
   */
  async getExpenseSummaryReport(
    businessId: string,
    branchId: string,
    isAllBranchAdmin: boolean = false,
    startDate?: string,
    endDate?: string,
  ) {
    const where: Prisma.ExpenseWhereInput = {
      business_id: businessId,
      ...(isAllBranchAdmin ? {} : { branch_id: branchId }),
      ...(startDate || endDate
        ? {
            expense_date: {
              ...(startDate ? { gte: new Date(startDate) } : {}),
              ...(endDate ? { lte: new Date(endDate) } : {}),
            },
          }
        : {}),
    };

    const expenses = await this.prisma.expense.findMany({
      where,
      include: {
        category: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
      },
    });

    let totalExpenseAmount = new Prisma.Decimal(0);
    const byCategoryMap = new Map<string, { categoryName: string; total: Prisma.Decimal }>();
    const byBranchMap = new Map<string, { branchName: string; total: Prisma.Decimal }>();
    const byVendorMap = new Map<string, { vendorName: string; total: Prisma.Decimal }>();

    for (const exp of expenses) {
      const expTotal = new Prisma.Decimal(exp.total_amount);
      totalExpenseAmount = totalExpenseAmount.plus(expTotal);

      // By Category
      const catKey = exp.expense_category_id;
      const catData = byCategoryMap.get(catKey) || {
        categoryName: exp.category.name,
        total: new Prisma.Decimal(0),
      };
      catData.total = catData.total.plus(expTotal);
      byCategoryMap.set(catKey, catData);

      // By Branch
      const bKey = exp.branch_id;
      const bData = byBranchMap.get(bKey) || {
        branchName: exp.branch.name,
        total: new Prisma.Decimal(0),
      };
      bData.total = bData.total.plus(expTotal);
      byBranchMap.set(bKey, bData);

      // By Vendor
      const vKey = exp.vendor_name || 'Unspecified';
      const vData = byVendorMap.get(vKey) || {
        vendorName: vKey,
        total: new Prisma.Decimal(0),
      };
      vData.total = vData.total.plus(expTotal);
      byVendorMap.set(vKey, vData);
    }

    const topVendors = Array.from(byVendorMap.values())
      .sort((a, b) => b.total.comparedTo(a.total))
      .slice(0, 5)
      .map((v) => ({ vendorName: v.vendorName, total: v.total.toString() }));

    return {
      totalExpenseAmount: totalExpenseAmount.toString(),
      count: expenses.length,
      byCategory: Array.from(byCategoryMap.values()).map((c) => ({
        categoryName: c.categoryName,
        total: c.total.toString(),
      })),
      byBranch: Array.from(byBranchMap.values()).map((b) => ({
        branchName: b.branchName,
        total: b.total.toString(),
      })),
      topVendors,
    };
  }
}
