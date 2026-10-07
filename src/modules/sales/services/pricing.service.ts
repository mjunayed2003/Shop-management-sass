import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { PriceListService } from '../../catalog/services/price-list.service.js';
import { CartItemDto, CalculateSaleDto } from '../dto/calculate-sale.dto.js';
import { Prisma, PriceListType, SaleType } from '../../../generated/prisma/client.js';

export interface CalculatedItem {
  variantId: string;
  variantSku: string;
  variantName: string;
  productName: string;
  productId: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  basePrice: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  isCustomPrice: boolean;
  sourceBranchId?: string;
  productUnitId?: string;
  productUnitBarcode?: string;
  trackIndividually: boolean;
}

export interface CalculatedCart {
  items: CalculatedItem[];
  subtotal: Prisma.Decimal;
  lineDiscountTotal: Prisma.Decimal;
  couponDiscount: Prisma.Decimal;
  totalDiscount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  rawTotal: Prisma.Decimal;
  roundOff: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  couponId?: string;
  couponCode?: string;
}

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly priceListService: PriceListService,
  ) {}

  /**
   * Calculates all cart totals, applying price resolution, role discount validations,
   * coupon checks, tax calculations, and Bangladesh Taka integer round-off.
   * Uses Prisma.Decimal throughout to ensure zero floating-point inaccuracies.
   */
  async calculateCart(
    businessId: string,
    currentBranchId: string,
    dto: CalculateSaleDto,
    userRole?: { code?: string; name?: string; permissions?: string[] },
    tx?: Prisma.TransactionClient,
  ): Promise<CalculatedCart> {
    const client = tx || this.prisma;
    const saleType = dto.saleType || SaleType.RETAIL;

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Cart must contain at least one item.');
    }

    const calculatedItems: CalculatedItem[] = [];
    let subtotal = new Prisma.Decimal(0);
    let lineDiscountTotal = new Prisma.Decimal(0);
    let taxTotal = new Prisma.Decimal(0);

    // Business tax rate (default 0%)
    const taxRate = new Prisma.Decimal(0); // 0% default per requirements

    for (const itemDto of dto.items) {
      const { item, resolvedVariant, unit } = await this.resolveItem(
        client,
        businessId,
        itemDto,
      );

      const qty = new Prisma.Decimal(itemDto.quantity);
      if (qty.lessThanOrEqualTo(0)) {
        throw new BadRequestException('Item quantity must be greater than zero.');
      }

      // 1. Resolve standard catalog price
      const catalogPriceNum = await this.priceListService.getVariantPrice(
        resolvedVariant.id,
        saleType === SaleType.WHOLESALE ? PriceListType.WHOLESALE : PriceListType.RETAIL,
      );
      const basePrice = new Prisma.Decimal(catalogPriceNum);

      let unitPrice = basePrice;
      let isCustomPrice = false;

      // 2. Manual price override or manual line discount validation
      if (itemDto.unitPrice !== undefined && itemDto.unitPrice !== null) {
        const manualPrice = new Prisma.Decimal(itemDto.unitPrice);
        if (manualPrice.lessThan(0)) {
          throw new BadRequestException('Unit price cannot be negative.');
        }

        if (!manualPrice.equals(basePrice)) {
          isCustomPrice = true;
          this.validateDiscountPermission(
            userRole,
            basePrice,
            manualPrice,
            'Price override',
          );
          unitPrice = manualPrice;
        }
      }

      let lineDiscount = new Prisma.Decimal(itemDto.discountAmount || 0);
      if (lineDiscount.lessThan(0)) {
        throw new BadRequestException('Line discount cannot be negative.');
      }

      const grossLine = unitPrice.times(qty);
      if (lineDiscount.greaterThan(grossLine)) {
        throw new BadRequestException(
          `Line discount (${lineDiscount}) cannot exceed gross item total (${grossLine}).`,
        );
      }

      if (lineDiscount.greaterThan(0)) {
        this.validateLineDiscountPermission(userRole, grossLine, lineDiscount);
      }

      const netLineBeforeTax = grossLine.minus(lineDiscount);
      const lineTax = netLineBeforeTax
        .times(taxRate)
        .dividedBy(100)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const lineTotal = netLineBeforeTax.plus(lineTax).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

      subtotal = subtotal.plus(grossLine);
      lineDiscountTotal = lineDiscountTotal.plus(lineDiscount);
      taxTotal = taxTotal.plus(lineTax);

      calculatedItems.push({
        variantId: resolvedVariant.id,
        variantSku: resolvedVariant.sku,
        variantName: `${resolvedVariant.product.name} (${resolvedVariant.size?.name || ''} / ${resolvedVariant.color?.name || ''})`.trim(),
        productName: resolvedVariant.product.name,
        productId: resolvedVariant.product.id,
        quantity: qty,
        unitPrice,
        basePrice,
        discountAmount: lineDiscount,
        taxAmount: lineTax,
        totalAmount: lineTotal,
        isCustomPrice,
        sourceBranchId: itemDto.sourceBranchId,
        productUnitId: unit?.id,
        productUnitBarcode: unit?.barcode_value || itemDto.productUnitBarcode,
        trackIndividually: resolvedVariant.product.track_individually,
      });
    }

    // 3. Process Coupon Discount
    let couponDiscount = new Prisma.Decimal(0);
    let appliedCouponId: string | undefined;
    let appliedCouponCode: string | undefined;

    if (dto.couponCode) {
      const couponValidation = await this.validateCoupon(
        client,
        businessId,
        dto.couponCode,
        subtotal.minus(lineDiscountTotal),
      );
      couponDiscount = couponValidation.discountAmount;
      appliedCouponId = couponValidation.coupon.id;
      appliedCouponCode = couponValidation.coupon.code;
    }

    const totalDiscount = lineDiscountTotal.plus(couponDiscount);
    const rawTotal = subtotal
      .minus(totalDiscount)
      .plus(taxTotal)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    // Ensure non-negative total
    const safeRawTotal = rawTotal.greaterThan(0) ? rawTotal : new Prisma.Decimal(0);

    // 4. Bangladesh Round-Off (nearest integer Taka)
    // Round to nearest integer: e.g. 1500.40 -> 1500.00 (-0.40), 1500.60 -> 1501.00 (+0.40)
    const roundedInt = Math.round(safeRawTotal.toNumber());
    const finalTotal = new Prisma.Decimal(roundedInt).toDecimalPlaces(2);
    const roundOff = finalTotal.minus(safeRawTotal).toDecimalPlaces(2);

    return {
      items: calculatedItems,
      subtotal: subtotal.toDecimalPlaces(2),
      lineDiscountTotal: lineDiscountTotal.toDecimalPlaces(2),
      couponDiscount: couponDiscount.toDecimalPlaces(2),
      totalDiscount: totalDiscount.toDecimalPlaces(2),
      taxAmount: taxTotal.toDecimalPlaces(2),
      rawTotal: safeRawTotal,
      roundOff,
      totalAmount: finalTotal,
      couponId: appliedCouponId,
      couponCode: appliedCouponCode,
    };
  }

  /**
   * Resolves cart item using variantId or scanned barcode.
   */
  private async resolveItem(
    client: Prisma.TransactionClient | PrismaService,
    businessId: string,
    dto: CartItemDto,
  ) {
    if (dto.variantId) {
      const variant = await client.productVariant.findFirst({
        where: { id: dto.variantId, business_id: businessId, deleted_at: null },
        include: {
          product: true,
          size: true,
          color: true,
        },
      });

      if (!variant) {
        throw new NotFoundException(`Product variant with ID "${dto.variantId}" not found.`);
      }
      if (variant.product.deleted_at !== null || !variant.product.is_active) {
        throw new BadRequestException(`Product "${variant.product.name}" is inactive or deleted.`);
      }

      let unit: any = null;
      if (dto.productUnitBarcode) {
        unit = await client.productUnit.findFirst({
          where: {
            business_id: businessId,
            barcode_value: dto.productUnitBarcode,
            product_variant_id: variant.id,
          },
        });
      }

      return { item: dto, resolvedVariant: variant, unit };
    }

    if (dto.barcode) {
      const cleanBarcode = dto.barcode.trim();

      // Check variant barcode
      const variant = await client.productVariant.findFirst({
        where: {
          business_id: businessId,
          barcode: cleanBarcode,
          deleted_at: null,
        },
        include: {
          product: true,
          size: true,
          color: true,
        },
      });

      if (variant) {
        if (variant.product.deleted_at !== null || !variant.product.is_active) {
          throw new BadRequestException(`Product "${variant.product.name}" is inactive or deleted.`);
        }
        return { item: dto, resolvedVariant: variant, unit: null };
      }

      // Check tracked unit barcode
      const unit = await client.productUnit.findFirst({
        where: {
          business_id: businessId,
          barcode_value: cleanBarcode,
        },
        include: {
          variant: {
            include: {
              product: true,
              size: true,
              color: true,
            },
          },
        },
      });

      if (unit && unit.variant) {
        if (unit.variant.product.deleted_at !== null || !unit.variant.product.is_active) {
          throw new BadRequestException(
            `Product "${unit.variant.product.name}" is inactive or deleted.`,
          );
        }
        return { item: dto, resolvedVariant: unit.variant, unit };
      }

      throw new NotFoundException(`No product or unit found with barcode "${cleanBarcode}".`);
    }

    throw new BadRequestException('Each item must specify either variantId or barcode.');
  }

  /**
   * Validates and calculates discount for a coupon.
   */
  async validateCoupon(
    client: Prisma.TransactionClient | PrismaService,
    businessId: string,
    couponCode: string,
    applicableSubtotal: Prisma.Decimal,
  ) {
    const coupon = await client.coupon.findFirst({
      where: {
        business_id: businessId,
        code: couponCode.trim(),
        is_active: true,
      },
      include: {
        discount: true,
      },
    });

    if (!coupon) {
      throw new NotFoundException(`Coupon "${couponCode}" is invalid or inactive.`);
    }

    const now = new Date();
    if (coupon.expires_at < now) {
      throw new BadRequestException(`Coupon "${couponCode}" has expired.`);
    }

    if (coupon.usage_limit !== null && coupon.usage_count >= coupon.usage_limit) {
      throw new BadRequestException(`Coupon "${couponCode}" has reached its maximum usage limit.`);
    }

    const discount = coupon.discount;
    if (!discount.is_active) {
      throw new BadRequestException(`Discount for coupon "${couponCode}" is inactive.`);
    }

    if (discount.starts_at > now || discount.ends_at < now) {
      throw new BadRequestException(`Coupon "${couponCode}" is not active for the current date.`);
    }

    if (discount.min_purchase_amount) {
      const minAmount = new Prisma.Decimal(discount.min_purchase_amount);
      if (applicableSubtotal.lessThan(minAmount)) {
        throw new BadRequestException(
          `Minimum purchase amount of BDT ${minAmount.toString()} required for coupon "${couponCode}". Current total: BDT ${applicableSubtotal.toString()}`,
        );
      }
    }

    let discountAmount = new Prisma.Decimal(0);
    if (discount.type === 'PERCENTAGE') {
      discountAmount = applicableSubtotal
        .times(new Prisma.Decimal(discount.value))
        .dividedBy(100)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

      if (discount.max_discount_amount) {
        const maxCap = new Prisma.Decimal(discount.max_discount_amount);
        if (discountAmount.greaterThan(maxCap)) {
          discountAmount = maxCap;
        }
      }
    } else {
      // FIXED_AMOUNT
      const fixedVal = new Prisma.Decimal(discount.value);
      discountAmount = fixedVal.lessThan(applicableSubtotal) ? fixedVal : applicableSubtotal;
    }

    return {
      coupon,
      discountAmount,
    };
  }

  /**
   * Validates permission and max discount percentage on manual price override.
   */
  private validateDiscountPermission(
    userRole: { code?: string; name?: string; permissions?: string[] } | undefined,
    basePrice: Prisma.Decimal,
    overridePrice: Prisma.Decimal,
    context: string,
  ) {
    if (!userRole) return;

    const hasDiscountPerm =
      userRole.permissions?.includes('sale.discount') ||
      userRole.permissions?.includes('sales:discount') ||
      userRole.permissions?.includes('sale:*') ||
      userRole.permissions?.includes('*') ||
      userRole.code === 'OWNER' ||
      userRole.code === 'SUPER_ADMIN';

    if (!hasDiscountPerm) {
      throw new ForbiddenException(
        `${context} requires the "sale.discount" permission.`,
      );
    }

    // Role-based max discount percentage check
    if (overridePrice.lessThan(basePrice)) {
      const discountPercent = basePrice
        .minus(overridePrice)
        .dividedBy(basePrice)
        .times(100)
        .toNumber();

      const maxAllowed = this.getMaxDiscountPercentForRole(userRole.code);
      if (discountPercent > maxAllowed) {
        throw new BadRequestException(
          `${context} of ${discountPercent.toFixed(1)}% exceeds your role's maximum allowed limit of ${maxAllowed}%.`,
        );
      }
    }
  }

  /**
   * Validates line discount permission and cap.
   */
  private validateLineDiscountPermission(
    userRole: { code?: string; name?: string; permissions?: string[] } | undefined,
    grossLine: Prisma.Decimal,
    discountAmount: Prisma.Decimal,
  ) {
    if (!userRole) return;

    const hasDiscountPerm =
      userRole.permissions?.includes('sale.discount') ||
      userRole.permissions?.includes('sales:discount') ||
      userRole.permissions?.includes('sale:*') ||
      userRole.permissions?.includes('*') ||
      userRole.code === 'OWNER' ||
      userRole.code === 'SUPER_ADMIN';

    if (!hasDiscountPerm) {
      throw new ForbiddenException(
        'Line discounts require the "sale.discount" permission.',
      );
    }

    const discountPercent = discountAmount
      .dividedBy(grossLine)
      .times(100)
      .toNumber();

    const maxAllowed = this.getMaxDiscountPercentForRole(userRole.code);
    if (discountPercent > maxAllowed) {
      throw new BadRequestException(
        `Line discount of ${discountPercent.toFixed(1)}% exceeds your role's maximum allowed limit of ${maxAllowed}%.`,
      );
    }
  }

  private getMaxDiscountPercentForRole(roleCode?: string): number {
    switch (roleCode?.toUpperCase()) {
      case 'OWNER':
      case 'SUPER_ADMIN':
        return 100;
      case 'STORE_MANAGER':
      case 'BRANCH_MANAGER':
        return 30;
      case 'SALES_EXECUTIVE':
      case 'CASHIER':
      default:
        return 15;
    }
  }
}
