import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { SalesReturnService } from './sales-return.service.js';
import { SaleService } from './sale.service.js';
import { SequenceService } from '../../inventory/services/sequence.service.js';
import { RegisterSessionService } from './register-session.service.js';
import { CreateExchangeDto, ExchangeQueryDto } from '../dto/exchange.dto.js';
import {
  Prisma,
  RefundMethod,
  ExchangeDiffStatus,
  ExchangeItemType,
  SaleType,
} from '../../../generated/prisma/client.js';
import type { UserRoleContext } from './sales-return.service.js';

@Injectable()
export class ExchangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesReturnService: SalesReturnService,
    private readonly saleService: SaleService,
    private readonly sequenceService: SequenceService,
    private readonly registerSessionService: RegisterSessionService,
  ) {}

  /**
   * Main entry point to process an Exchange in ONE atomic transaction.
   * Reuses SalesReturnService and SaleService internally.
   */
  async createExchange(
    businessId: string,
    currentBranchId: string,
    userId: string,
    dto: CreateExchangeDto,
    userRole?: UserRoleContext,
  ) {
    if (!dto.returnedItems || dto.returnedItems.length === 0) {
      throw new BadRequestException('Exchange requires at least one returned item.');
    }
    if (!dto.newItems || dto.newItems.length === 0) {
      throw new BadRequestException('Exchange requires at least one new item to take.');
    }

    // 0. Idempotency Check
    const existingExchange = await this.prisma.exchange.findFirst({
      where: {
        business_id: businessId,
        idempotency_key: dto.idempotencyKey,
      },
      include: {
        items: true,
        sales_return: true,
        new_sale: true,
      },
    });

    if (existingExchange) {
      return existingExchange;
    }

    return this.prisma.$transaction(
      async (tx) => {
        // 1. Locate original sale to verify existence and customer
        const originalSale = await tx.sale.findFirst({
          where: {
            business_id: businessId,
            ...(dto.originalSaleId
              ? { id: dto.originalSaleId }
              : { invoice_no: dto.originalInvoiceNo }),
          },
          include: {
            items: true,
          },
        });

        if (!originalSale) {
          throw new NotFoundException(
            `Original sale not found with identifier "${dto.originalSaleId || dto.originalInvoiceNo}".`,
          );
        }

        if (originalSale.status === 'VOIDED') {
          throw new BadRequestException('Cannot exchange items from a VOIDED sale.');
        }

        // 2. Process RETURN part inside this transaction
        // Uses refund_method = ADJUSTED_IN_EXCHANGE
        const returnResult = await this.salesReturnService.processReturnLogicTx(
          tx,
          businessId,
          currentBranchId,
          userId,
          {
            saleId: originalSale.id,
            items: dto.returnedItems,
            refundMethod: RefundMethod.ADJUSTED_IN_EXCHANGE,
            reason: dto.reason || 'Exchanged for new merchandise',
            idempotencyKey: `${dto.idempotencyKey}:ret`,
          },
          userRole,
        );

        const returnedTotal = new Prisma.Decimal(returnResult.total_refund_amount);

        // 3. Process NEW SALE part inside this transaction
        // The returned value acts as store credit on the new sale
        const newSaleResponse = await this.saleService.createSale(
          businessId,
          currentBranchId,
          userId,
          {
            saleType: SaleType.RETAIL,
            items: dto.newItems,
            payments: dto.payments || [],
            customerId: originalSale.customer_id || undefined,
            idempotencyKey: `${dto.idempotencyKey}:sale`,
          },
          userRole,
          {
            tx,
            exchangeCreditAmount: returnedTotal,
          },
        );

        const newSaleId = (newSaleResponse as any).id;
        const newItemsTotal = new Prisma.Decimal((newSaleResponse as any).totalAmount);

        // 4. Compute difference & adjustment status
        const diff = newItemsTotal.minus(returnedTotal);
        let adjustmentStatus: ExchangeDiffStatus = ExchangeDiffStatus.EVEN;

        if (diff.greaterThan(0)) {
          adjustmentStatus = ExchangeDiffStatus.CUSTOMER_PAID;
        } else if (diff.lessThan(0)) {
          adjustmentStatus = ExchangeDiffStatus.SHOP_REFUNDED;

          // If shop refunds cash back, validate open register session
          await this.registerSessionService.validateActiveSession(
            businessId,
            currentBranchId,
            userId,
          );
        } else {
          adjustmentStatus = ExchangeDiffStatus.EVEN;
        }

        // 5. Check if original sale was fully exchanged
        const allOriginalItems = await tx.saleItem.findMany({
          where: { sale_id: originalSale.id },
        });
        const isFullyExchanged = allOriginalItems.every((si) =>
          new Prisma.Decimal(si.returned_qty).greaterThanOrEqualTo(si.quantity),
        );

        if (isFullyExchanged) {
          await tx.sale.update({
            where: { id: originalSale.id },
            data: { status: 'EXCHANGED' },
          });
        }

        // 6. Generate exchange_no atomically via InvoiceSequence (EXCHANGE)
        const exchangeNo = await this.sequenceService.getNextNumber(
          tx,
          businessId,
          currentBranchId,
          'EXCHANGE',
          'EXC-',
        );

        // 7. Create Exchange record
        const exchange = await tx.exchange.create({
          data: {
            business_id: businessId,
            branch_id: currentBranchId,
            original_sale_id: originalSale.id,
            sales_return_id: returnResult.id,
            new_sale_id: newSaleId,
            exchange_no: exchangeNo,
            idempotency_key: dto.idempotencyKey,
            returned_total: returnedTotal,
            new_items_total: newItemsTotal,
            difference_amount: diff,
            adjustment_status: adjustmentStatus,
            created_by: userId,
          },
        });

        // 8. Create ExchangeItem records
        const exchangeItemsData: Prisma.ExchangeItemCreateManyInput[] = [];

        // Return items
        for (const retItem of returnResult.items) {
          exchangeItemsData.push({
            exchange_id: exchange.id,
            type: ExchangeItemType.RETURNED,
            sale_item_id: retItem.sale_item_id,
            product_variant_id: retItem.product_variant_id,
            quantity: retItem.quantity,
            unit_price: retItem.refund_price,
            total_amount: retItem.total_refund,
          });
        }

        // Taken items from new sale
        const createdNewSaleItems = await tx.saleItem.findMany({
          where: { sale_id: newSaleId },
        });

        for (const newItem of createdNewSaleItems) {
          exchangeItemsData.push({
            exchange_id: exchange.id,
            type: ExchangeItemType.TAKEN,
            sale_item_id: newItem.id,
            product_variant_id: newItem.product_variant_id,
            quantity: newItem.quantity,
            unit_price: newItem.unit_price,
            total_amount: newItem.total_amount,
          });
        }

        await tx.exchangeItem.createMany({
          data: exchangeItemsData,
        });

        // 9. Audit Log
        await tx.auditLog.create({
          data: {
            business_id: businessId,
            branch_id: currentBranchId,
            user_id: userId,
            action: 'CREATE',
            entity_table: 'exchanges',
            entity_id: exchange.id,
            new_values: {
              exchange_no: exchangeNo,
              original_sale_id: originalSale.id,
              sales_return_id: returnResult.id,
              new_sale_id: newSaleId,
              returned_total: returnedTotal.toString(),
              new_items_total: newItemsTotal.toString(),
              difference_amount: diff.toString(),
              adjustment_status: adjustmentStatus,
            },
          },
        });

        return {
          ...exchange,
          salesReturn: returnResult,
          newSale: newSaleResponse,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  /**
   * List exchanges (branch-scoped, admin sees all branches).
   */
  async getExchangeList(
    businessId: string,
    branchId: string,
    query: ExchangeQueryDto,
    isAllBranchAdmin: boolean = false,
  ) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.ExchangeWhereInput = {
      business_id: businessId,
      ...(isAllBranchAdmin ? {} : { branch_id: branchId }),
      ...(query.originalSaleId ? { original_sale_id: query.originalSaleId } : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.exchange.count({ where }),
      this.prisma.exchange.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          items: true,
          original_sale: { select: { id: true, invoice_no: true } },
          new_sale: { select: { id: true, invoice_no: true, total_amount: true, paid_amount: true } },
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
   * Detail of a single Exchange.
   */
  async getExchangeDetail(
    businessId: string,
    branchId: string,
    exchangeId: string,
    isAllBranchAdmin: boolean = false,
  ) {
    const exchange = await this.prisma.exchange.findFirst({
      where: {
        id: exchangeId,
        business_id: businessId,
        ...(isAllBranchAdmin ? {} : { branch_id: branchId }),
      },
      include: {
        items: {
          include: {
            variant: true,
          },
        },
        original_sale: true,
        sales_return: {
          include: {
            items: true,
          },
        },
        new_sale: {
          include: {
            items: true,
            payments: true,
          },
        },
      },
    });

    if (!exchange) {
      throw new NotFoundException(
        `Exchange with ID "${exchangeId}" not found in this branch context.`,
      );
    }

    return exchange;
  }
}
