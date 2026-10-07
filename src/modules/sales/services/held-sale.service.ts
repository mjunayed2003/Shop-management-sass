import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { PricingService } from './pricing.service.js';
import { HoldCartDto } from '../dto/held-sale.dto.js';
import { Prisma } from '../../../generated/prisma/client.js';

@Injectable()
export class HeldSaleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingService: PricingService,
  ) {}

  /**
   * Holds the current POS cart without reserving stock.
   */
  async holdCart(
    businessId: string,
    branchId: string,
    userId: string,
    dto: HoldCartDto,
  ) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Cannot hold an empty cart.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Validate customer if provided
      if (dto.customerId) {
        const customer = await tx.customer.findFirst({
          where: { id: dto.customerId, business_id: businessId, deleted_at: null },
        });
        if (!customer) {
          throw new NotFoundException(`Customer "${dto.customerId}" not found.`);
        }
      }

      // Compute tentative subtotal from items
      let subtotal = new Prisma.Decimal(0);
      for (const item of dto.items) {
        const unitPrice = new Prisma.Decimal(item.unitPrice || 0);
        const qty = new Prisma.Decimal(item.quantity);
        const discount = new Prisma.Decimal(item.discountAmount || 0);
        const lineTotal = unitPrice.times(qty).minus(discount);
        subtotal = subtotal.plus(lineTotal.greaterThan(0) ? lineTotal : 0);
      }

      const heldSale = await tx.heldSale.create({
        data: {
          business_id: businessId,
          branch_id: branchId,
          customer_id: dto.customerId || null,
          reference_name: dto.referenceName.trim(),
          subtotal: subtotal.toDecimalPlaces(2),
          created_by: userId,
          is_retrieved: false,
        },
      });

      for (const item of dto.items) {
        const qty = new Prisma.Decimal(item.quantity);
        const unitPrice = new Prisma.Decimal(item.unitPrice || 0);
        const discount = new Prisma.Decimal(item.discountAmount || 0);
        const total = unitPrice.times(qty).minus(discount);

        await tx.heldSaleItem.create({
          data: {
            held_sale_id: heldSale.id,
            product_variant_id: item.variantId,
            quantity: qty,
            unit_price: unitPrice,
            discount_amount: discount,
            total_amount: total.greaterThan(0) ? total : new Prisma.Decimal(0),
          },
        });
      }

      return tx.heldSale.findUniqueOrThrow({
        where: { id: heldSale.id },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          items: {
            include: {
              variant: {
                select: {
                  id: true,
                  sku: true,
                  barcode: true,
                  product: { select: { name: true } },
                },
              },
            },
          },
        },
      });
    });
  }

  /**
   * Lists all active unretrieved held sales for the branch.
   */
  async listHeldSales(businessId: string, branchId: string) {
    return this.prisma.heldSale.findMany({
      where: {
        business_id: businessId,
        branch_id: branchId,
        is_retrieved: false,
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        items: {
          include: {
            variant: {
              select: {
                id: true,
                sku: true,
                product: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Retrieves a held sale, marks it retrieved, and re-prices all items
   * via PricingService to ensure fresh catalog pricing.
   */
  async retrieveHeldSale(
    businessId: string,
    branchId: string,
    heldSaleId: string,
  ) {
    const heldSale = await this.prisma.heldSale.findFirst({
      where: {
        id: heldSaleId,
        business_id: businessId,
        branch_id: branchId,
      },
      include: {
        items: true,
      },
    });

    if (!heldSale) {
      throw new NotFoundException(`Held sale "${heldSaleId}" not found in this branch.`);
    }

    if (heldSale.is_retrieved) {
      throw new BadRequestException(`Held sale "${heldSaleId}" has already been retrieved.`);
    }

    // Mark retrieved
    await this.prisma.heldSale.update({
      where: { id: heldSaleId },
      data: { is_retrieved: true },
    });

    // Re-price through calculateCart (fetch fresh catalog prices, do not trust stored unit_price)
    const repricedCart = await this.pricingService.calculateCart(
      businessId,
      branchId,
      {
        items: heldSale.items.map((i) => ({
          variantId: i.product_variant_id,
          quantity: Number(i.quantity),
          discountAmount: Number(i.discount_amount),
        })),
        customerId: heldSale.customer_id || undefined,
      },
    );

    return {
      heldSaleId: heldSale.id,
      referenceName: heldSale.reference_name,
      customerId: heldSale.customer_id,
      isRetrieved: true,
      repricedCart,
    };
  }

  /**
   * Deletes a held sale.
   */
  async deleteHeldSale(businessId: string, branchId: string, heldSaleId: string) {
    const heldSale = await this.prisma.heldSale.findFirst({
      where: {
        id: heldSaleId,
        business_id: businessId,
        branch_id: branchId,
      },
    });

    if (!heldSale) {
      throw new NotFoundException(`Held sale "${heldSaleId}" not found in this branch.`);
    }

    await this.prisma.heldSale.delete({
      where: { id: heldSaleId },
    });

    return { message: `Held sale "${heldSaleId}" deleted successfully.` };
  }
}
