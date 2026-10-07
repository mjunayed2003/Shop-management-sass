import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { PhoneNormalizerService } from './phone-normalizer.service.js';
import {
  CreateCustomerDto,
  QuickCreateCustomerDto,
  UpdateCustomerDto,
  CustomerQueryDto,
  CustomerLedgerQueryDto,
} from '../dto/customer.dto.js';
import { Prisma } from '../../../generated/prisma/client.js';

@Injectable()
export class CustomerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly phoneNormalizer: PhoneNormalizerService,
  ) {}

  async createCustomer(businessId: string, dto: CreateCustomerDto) {
    const normalizedPhone = this.phoneNormalizer.normalize(dto.phone);

    const existing = await this.prisma.customer.findFirst({
      where: {
        business_id: businessId,
        phone: normalizedPhone,
      },
    });

    if (existing) {
      if (existing.deleted_at === null) {
        throw new ConflictException(
          `Customer with phone "${normalizedPhone}" already exists in your business.`,
        );
      } else {
        // Reactivate soft-deleted customer
        return this.prisma.customer.update({
          where: { id: existing.id },
          data: {
            name: dto.name.trim(),
            email: dto.email?.trim().toLowerCase() || null,
            address: dto.address?.trim() || null,
            credit_limit: new Prisma.Decimal(dto.creditLimit || 0),
            deleted_at: null,
            is_active: true,
          },
        });
      }
    }

    const openingDue = new Prisma.Decimal(dto.openingDue || 0);

    return this.prisma.customer.create({
      data: {
        business_id: businessId,
        name: dto.name.trim(),
        phone: normalizedPhone,
        email: dto.email?.trim().toLowerCase() || null,
        address: dto.address?.trim() || null,
        opening_due: openingDue,
        current_due: openingDue,
        credit_limit: new Prisma.Decimal(dto.creditLimit || 0),
        loyalty_points: 0,
      },
    });
  }

  async quickCreateCustomer(businessId: string, dto: QuickCreateCustomerDto) {
    const normalizedPhone = this.phoneNormalizer.normalize(dto.phone);

    const existing = await this.prisma.customer.findFirst({
      where: {
        business_id: businessId,
        phone: normalizedPhone,
        deleted_at: null,
      },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.customer.create({
      data: {
        business_id: businessId,
        name: dto.name.trim(),
        phone: normalizedPhone,
        opening_due: new Prisma.Decimal(0),
        current_due: new Prisma.Decimal(0),
        credit_limit: new Prisma.Decimal(0),
        loyalty_points: 0,
      },
    });
  }

  async lookupByPhone(businessId: string, rawPhone: string) {
    const normalizedPhone = this.phoneNormalizer.normalize(rawPhone);

    const customer = await this.prisma.customer.findFirst({
      where: {
        business_id: businessId,
        phone: normalizedPhone,
        deleted_at: null,
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with phone "${rawPhone}" not found.`);
    }

    return {
      ...customer,
      opening_due: Number(customer.opening_due),
      current_due: Number(customer.current_due),
      credit_limit: Number(customer.credit_limit),
    };
  }

  async listCustomers(businessId: string, query: CustomerQueryDto) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Number(query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.CustomerWhereInput = {
      business_id: businessId,
      deleted_at: null,
      ...(query.isActive !== undefined && { is_active: query.isActive }),
      ...(query.search && {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { phone: { contains: query.search } },
        ],
      }),
    };

    const [total, customers] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
    ]);

    return {
      data: customers.map((c) => ({
        ...c,
        opening_due: Number(c.opening_due),
        current_due: Number(c.current_due),
        credit_limit: Number(c.credit_limit),
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getCustomerById(businessId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, business_id: businessId, deleted_at: null },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID "${id}" not found.`);
    }

    return {
      ...customer,
      opening_due: Number(customer.opening_due),
      current_due: Number(customer.current_due),
      credit_limit: Number(customer.credit_limit),
    };
  }

  async updateCustomer(businessId: string, id: string, dto: UpdateCustomerDto) {
    await this.getCustomerById(businessId, id);

    let normalizedPhone: string | undefined;
    if (dto.phone) {
      normalizedPhone = this.phoneNormalizer.normalize(dto.phone);
      const duplicate = await this.prisma.customer.findFirst({
        where: {
          business_id: businessId,
          phone: normalizedPhone,
          id: { not: id },
          deleted_at: null,
        },
      });
      if (duplicate) {
        throw new ConflictException(`Phone "${normalizedPhone}" is already assigned to another customer.`);
      }
    }

    return this.prisma.customer.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name.trim() }),
        ...(normalizedPhone && { phone: normalizedPhone }),
        ...(dto.email !== undefined && { email: dto.email?.trim().toLowerCase() || null }),
        ...(dto.address !== undefined && { address: dto.address?.trim() || null }),
        ...(dto.creditLimit !== undefined && { credit_limit: new Prisma.Decimal(dto.creditLimit) }),
        ...(dto.isActive !== undefined && { is_active: dto.isActive }),
      },
    });
  }

  async deleteCustomer(businessId: string, id: string) {
    await this.getCustomerById(businessId, id);

    return this.prisma.customer.update({
      where: { id },
      data: {
        deleted_at: new Date(),
        is_active: false,
      },
    });
  }

  /**
   * Customer Ledger: records sales, returns, due collections, and running due balance.
   * Tracks branch details for each transaction.
   */
  async getCustomerLedger(
    businessId: string,
    customerId: string,
    query: CustomerLedgerQueryDto,
  ) {
    const customer = await this.getCustomerById(businessId, customerId);

    const [sales, returns, dueCollections] = await Promise.all([
      this.prisma.sale.findMany({
        where: {
          business_id: businessId,
          customer_id: customerId,
          status: { not: 'VOIDED' },
          ...(query.startDate || query.endDate
            ? {
                sale_date: {
                  ...(query.startDate && { gte: new Date(query.startDate) }),
                  ...(query.endDate && { lte: new Date(query.endDate) }),
                },
              }
            : {}),
        },
        include: { branch: { select: { id: true, name: true, code: true } } },
      }),
      this.prisma.salesReturn.findMany({
        where: {
          business_id: businessId,
          customer_id: customerId,
          ...(query.startDate || query.endDate
            ? {
                created_at: {
                  ...(query.startDate && { gte: new Date(query.startDate) }),
                  ...(query.endDate && { lte: new Date(query.endDate) }),
                },
              }
            : {}),
        },
        include: { branch: { select: { id: true, name: true, code: true } } },
      }),
      this.prisma.dueCollection.findMany({
        where: {
          business_id: businessId,
          customer_id: customerId,
          ...(query.startDate || query.endDate
            ? {
                receipt_date: {
                  ...(query.startDate && { gte: new Date(query.startDate) }),
                  ...(query.endDate && { lte: new Date(query.endDate) }),
                },
              }
            : {}),
        },
        include: { branch: { select: { id: true, name: true, code: true } } },
      }),
    ]);

    interface LedgerEntry {
      date: Date;
      type: 'SALE' | 'RETURN' | 'DUE_COLLECTION';
      referenceNo: string;
      branch: { id: string; name: string; code: string };
      debit: number; // increases due (credit sales)
      credit: number; // decreases due (payments, returns)
      amount: number;
    }

    const rawEntries: LedgerEntry[] = [
      ...sales
        .filter((s) => Number(s.due_amount) > 0)
        .map((s) => ({
          date: s.sale_date,
          type: 'SALE' as const,
          referenceNo: s.invoice_no,
          branch: s.branch,
          debit: Number(s.due_amount),
          credit: 0,
          amount: Number(s.due_amount),
        })),
      ...returns.map((r) => ({
        date: r.created_at,
        type: 'RETURN' as const,
        referenceNo: r.return_no,
        branch: r.branch,
        debit: 0,
        credit: Number(r.total_refund_amount),
        amount: Number(r.total_refund_amount),
      })),
      ...dueCollections.map((dc) => ({
        date: dc.receipt_date,
        type: 'DUE_COLLECTION' as const,
        referenceNo: dc.collection_no,
        branch: dc.branch,
        debit: 0,
        credit: Number(dc.amount),
        amount: Number(dc.amount),
      })),
    ];

    rawEntries.sort((a, b) => a.date.getTime() - b.date.getTime());

    let runningDue = customer.opening_due;
    const entries = rawEntries.map((e) => {
      runningDue = runningDue + e.debit - e.credit;
      return {
        ...e,
        runningDue: Math.round(runningDue * 100) / 100,
      };
    });

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        openingDue: customer.opening_due,
        currentDue: customer.current_due,
        creditLimit: customer.credit_limit,
      },
      ledger: entries,
    };
  }

  /**
   * Customer Due Summary grouped by branch (calculated from Sale.due_amount).
   */
  async getCustomerDueSummaryByBranch(businessId: string) {
    const salesWithDue = await this.prisma.sale.findMany({
      where: {
        business_id: businessId,
        due_amount: { gt: 0 },
        status: { not: 'VOIDED' },
      },
      select: {
        branch_id: true,
        due_amount: true,
        branch: { select: { id: true, name: true, code: true } },
      },
    });

    const branchDueMap = new Map<string, { branchId: string; branchName: string; branchCode: string; totalDue: number; count: number }>();

    for (const s of salesWithDue) {
      const b = branchDueMap.get(s.branch_id) || {
        branchId: s.branch.id,
        branchName: s.branch.name,
        branchCode: s.branch.code,
        totalDue: 0,
        count: 0,
      };
      b.totalDue += Number(s.due_amount);
      b.count += 1;
      branchDueMap.set(s.branch_id, b);
    }

    return {
      branches: Array.from(branchDueMap.values()).map((b) => ({
        ...b,
        totalDue: Math.round(b.totalDue * 100) / 100,
      })),
    };
  }
}
