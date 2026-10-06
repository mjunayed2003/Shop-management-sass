import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  CreateSupplierDto,
  UpdateSupplierDto,
  SupplierQueryDto,
  SupplierLedgerQueryDto,
} from '../dto/supplier.dto.js';
import { Prisma } from '../../../generated/prisma/client.js';

@Injectable()
export class SupplierService {
  constructor(private readonly prisma: PrismaService) {}

  async createSupplier(businessId: string, dto: CreateSupplierDto) {
    const existing = await this.prisma.supplier.findFirst({
      where: {
        business_id: businessId,
        code: dto.code.trim().toUpperCase(),
        deleted_at: null,
      },
    });

    if (existing) {
      throw new ConflictException(
        `Supplier with code "${dto.code}" already exists in your business.`,
      );
    }

    const openingBalance = new Prisma.Decimal(dto.openingBalance || 0);

    return this.prisma.supplier.create({
      data: {
        business_id: businessId,
        name: dto.name.trim(),
        code: dto.code.trim().toUpperCase(),
        company_name: dto.companyName?.trim() || null,
        phone: dto.phone.trim(),
        email: dto.email?.trim().toLowerCase() || null,
        address: dto.address?.trim() || null,
        city: dto.city?.trim() || null,
        opening_balance: openingBalance,
        current_balance: openingBalance,
      },
    });
  }

  async listSuppliers(businessId: string, query: SupplierQueryDto) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Number(query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.SupplierWhereInput = {
      business_id: businessId,
      deleted_at: null,
      ...(query.isActive !== undefined && { is_active: query.isActive }),
      ...(query.search && {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { code: { contains: query.search, mode: 'insensitive' } },
          { phone: { contains: query.search, mode: 'insensitive' } },
          { company_name: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };

    const [total, suppliers] = await Promise.all([
      this.prisma.supplier.count({ where }),
      this.prisma.supplier.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
    ]);

    return {
      data: suppliers.map((s) => ({
        ...s,
        opening_balance: Number(s.opening_balance),
        current_balance: Number(s.current_balance),
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getSupplierById(businessId: string, id: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, business_id: businessId, deleted_at: null },
      include: {
        _count: {
          select: {
            purchases: true,
            purchase_returns: true,
            supplier_payments: true,
          },
        },
      },
    });

    if (!supplier) {
      throw new NotFoundException(`Supplier with ID "${id}" not found.`);
    }

    return {
      ...supplier,
      opening_balance: Number(supplier.opening_balance),
      current_balance: Number(supplier.current_balance),
    };
  }

  async updateSupplier(businessId: string, id: string, dto: UpdateSupplierDto) {
    await this.getSupplierById(businessId, id);

    return this.prisma.supplier.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name.trim() }),
        ...(dto.companyName !== undefined && { company_name: dto.companyName?.trim() || null }),
        ...(dto.phone && { phone: dto.phone.trim() }),
        ...(dto.email !== undefined && { email: dto.email?.trim().toLowerCase() || null }),
        ...(dto.address !== undefined && { address: dto.address?.trim() || null }),
        ...(dto.city !== undefined && { city: dto.city?.trim() || null }),
        ...(dto.isActive !== undefined && { is_active: dto.isActive }),
      },
    });
  }

  async deleteSupplier(businessId: string, id: string) {
    await this.getSupplierById(businessId, id);

    return this.prisma.supplier.update({
      where: { id },
      data: {
        deleted_at: new Date(),
        is_active: false,
      },
    });
  }

  /**
   * Supplier Ledger: chronological record of opening balance, purchases, returns, and payments.
   * Computes running balance: opening_balance + purchases - returns - payments.
   */
  async getSupplierLedger(
    businessId: string,
    supplierId: string,
    query: SupplierLedgerQueryDto,
  ) {
    const supplier = await this.getSupplierById(businessId, supplierId);

    const [purchases, returns, payments] = await Promise.all([
      this.prisma.purchase.findMany({
        where: {
          business_id: businessId,
          supplier_id: supplierId,
          status: { not: 'CANCELLED' },
          ...(query.startDate || query.endDate
            ? {
                purchase_date: {
                  ...(query.startDate && { gte: new Date(query.startDate) }),
                  ...(query.endDate && { lte: new Date(query.endDate) }),
                },
              }
            : {}),
        },
        select: {
          id: true,
          purchase_no: true,
          purchase_date: true,
          total_amount: true,
          notes: true,
        },
      }),
      this.prisma.purchaseReturn.findMany({
        where: {
          business_id: businessId,
          supplier_id: supplierId,
          status: { not: 'CANCELLED' },
          ...(query.startDate || query.endDate
            ? {
                return_date: {
                  ...(query.startDate && { gte: new Date(query.startDate) }),
                  ...(query.endDate && { lte: new Date(query.endDate) }),
                },
              }
            : {}),
        },
        select: {
          id: true,
          return_no: true,
          return_date: true,
          total_amount: true,
          reason: true,
        },
      }),
      this.prisma.supplierPayment.findMany({
        where: {
          business_id: businessId,
          supplier_id: supplierId,
          ...(query.startDate || query.endDate
            ? {
                payment_date: {
                  ...(query.startDate && { gte: new Date(query.startDate) }),
                  ...(query.endDate && { lte: new Date(query.endDate) }),
                },
              }
            : {}),
        },
        select: {
          id: true,
          payment_no: true,
          payment_date: true,
          amount: true,
          payment_method: true,
          notes: true,
        },
      }),
    ]);

    interface LedgerEntry {
      date: Date;
      type: 'PURCHASE' | 'RETURN' | 'PAYMENT';
      referenceNo: string;
      description?: string | null;
      debit: number; // decreases liability (returns, payments)
      credit: number; // increases liability (purchases)
      amount: number;
    }

    const rawEntries: LedgerEntry[] = [
      ...purchases.map((p) => ({
        date: p.purchase_date,
        type: 'PURCHASE' as const,
        referenceNo: p.purchase_no,
        description: p.notes,
        credit: Number(p.total_amount),
        debit: 0,
        amount: Number(p.total_amount),
      })),
      ...returns.map((r) => ({
        date: r.return_date,
        type: 'RETURN' as const,
        referenceNo: r.return_no,
        description: r.reason,
        credit: 0,
        debit: Number(r.total_amount),
        amount: Number(r.total_amount),
      })),
      ...payments.map((pm) => ({
        date: pm.payment_date,
        type: 'PAYMENT' as const,
        referenceNo: pm.payment_no,
        description: pm.notes,
        credit: 0,
        debit: Number(pm.amount),
        amount: Number(pm.amount),
      })),
    ];

    rawEntries.sort((a, b) => a.date.getTime() - b.date.getTime());

    let runningBalance = supplier.opening_balance;
    const entries = rawEntries.map((e) => {
      runningBalance = runningBalance + e.credit - e.debit;
      return {
        ...e,
        runningBalance: Math.round(runningBalance * 100) / 100,
      };
    });

    return {
      supplier: {
        id: supplier.id,
        name: supplier.name,
        code: supplier.code,
        openingBalance: supplier.opening_balance,
        currentBalance: supplier.current_balance,
      },
      ledger: entries,
    };
  }
}
