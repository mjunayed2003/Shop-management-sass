import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { SequenceService } from './sequence.service.js';
import {
  CreateSupplierPaymentDto,
  SupplierPaymentQueryDto,
} from '../dto/supplier-payment.dto.js';
import { Prisma } from '../../../generated/prisma/client.js';

@Injectable()
export class SupplierPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequenceService: SequenceService,
  ) {}

  async createPayment(
    businessId: string,
    branchId: string,
    userId: string,
    dto: CreateSupplierPaymentDto,
  ) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, business_id: businessId, deleted_at: null },
    });
    if (!supplier) {
      throw new NotFoundException(`Supplier with ID "${dto.supplierId}" not found.`);
    }

    const payAmount = new Prisma.Decimal(dto.amount);
    if (payAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Payment amount must be greater than zero.');
    }

    return this.prisma.$transaction(async (tx) => {
      let linkedPurchase: any = null;

      if (dto.purchaseId) {
        linkedPurchase = await tx.purchase.findFirst({
          where: {
            id: dto.purchaseId,
            business_id: businessId,
            branch_id: branchId,
            supplier_id: dto.supplierId,
          },
        });

        if (!linkedPurchase) {
          throw new NotFoundException(`Purchase with ID "${dto.purchaseId}" not found for this supplier.`);
        }

        if (linkedPurchase.status === 'CANCELLED') {
          throw new BadRequestException('Cannot pay against a cancelled purchase.');
        }

        const due = new Prisma.Decimal(linkedPurchase.due_amount);
        if (payAmount.greaterThan(due)) {
          throw new BadRequestException(
            `Payment amount (${payAmount.toString()}) cannot exceed purchase due amount (${due.toString()}).`,
          );
        }

        const newPaid = new Prisma.Decimal(linkedPurchase.paid_amount).plus(payAmount);
        const newDue = due.minus(payAmount);
        const newStatus = newDue.isZero() ? 'PAID' : 'PARTIALLY_PAID';

        await tx.purchase.update({
          where: { id: linkedPurchase.id },
          data: {
            paid_amount: newPaid,
            due_amount: newDue,
            status: newStatus,
          },
        });
      }

      // Decrement supplier balance (payment reduces what business owes to supplier)
      await tx.supplier.update({
        where: { id: dto.supplierId },
        data: {
          current_balance: {
            decrement: payAmount,
          },
        },
      });

      const paymentNo = await this.sequenceService.getNextNumber(
        tx,
        businessId,
        branchId,
        'EXPENSE_VOUCHER',
        'PAY-',
      );

      return tx.supplierPayment.create({
        data: {
          business_id: businessId,
          branch_id: branchId,
          supplier_id: dto.supplierId,
          purchase_id: dto.purchaseId || null,
          payment_account_id: null, // Accounting payment_account_id stays null
          payment_no: paymentNo,
          amount: payAmount,
          payment_method: dto.paymentMethod,
          reference_no: dto.referenceNo?.trim() || null,
          payment_date: dto.paymentDate ? new Date(dto.paymentDate) : new Date(),
          notes: dto.notes?.trim() || null,
          created_by: userId,
        },
        include: {
          supplier: { select: { id: true, name: true, code: true } },
          purchase: { select: { id: true, purchase_no: true, total_amount: true, due_amount: true } },
        },
      });
    });
  }

  async listPayments(
    businessId: string,
    branchId: string,
    query: SupplierPaymentQueryDto,
  ) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Number(query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.SupplierPaymentWhereInput = {
      business_id: businessId,
      branch_id: branchId,
      ...(query.supplierId && { supplier_id: query.supplierId }),
      ...(query.purchaseId && { purchase_id: query.purchaseId }),
      ...(query.search && {
        OR: [
          { payment_no: { contains: query.search, mode: 'insensitive' } },
          { reference_no: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };

    const [total, payments] = await Promise.all([
      this.prisma.supplierPayment.count({ where }),
      this.prisma.supplierPayment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { payment_date: 'desc' },
        include: {
          supplier: { select: { id: true, name: true, code: true } },
          purchase: { select: { id: true, purchase_no: true } },
        },
      }),
    ]);

    return {
      data: payments,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getPaymentById(businessId: string, branchId: string, id: string) {
    const payment = await this.prisma.supplierPayment.findFirst({
      where: { id, business_id: businessId, branch_id: branchId },
      include: {
        supplier: true,
        purchase: true,
      },
    });

    if (!payment) {
      throw new NotFoundException(`Supplier Payment with ID "${id}" not found.`);
    }

    return payment;
  }
}
