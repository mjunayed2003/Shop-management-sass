import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  CreatePriceListDto,
  UpdatePriceListDto,
  SetPriceListItemDto,
} from '../dto/price-list.dto.js';
import { PriceListType } from '../../../generated/prisma/client.js';

@Injectable()
export class PriceListService {
  constructor(private readonly prisma: PrismaService) {}

  async createPriceList(businessId: string, dto: CreatePriceListDto) {
    const code = dto.code.trim().toUpperCase();

    const existing = await this.prisma.priceList.findUnique({
      where: {
        business_id_code: {
          business_id: businessId,
          code,
        },
      },
    });

    if (existing) {
      throw new ConflictException(`Price list with code "${code}" already exists in your business.`);
    }

    if (dto.isDefault) {
      // Unset other defaults of the same type
      await this.prisma.priceList.updateMany({
        where: {
          business_id: businessId,
          type: dto.type || PriceListType.RETAIL,
          is_default: true,
        },
        data: { is_default: false },
      });
    }

    return this.prisma.priceList.create({
      data: {
        business_id: businessId,
        name: dto.name.trim(),
        code,
        type: dto.type || PriceListType.RETAIL,
        is_default: dto.isDefault ?? false,
        is_active: dto.isActive ?? true,
      },
    });
  }

  async listPriceLists(businessId: string) {
    return this.prisma.priceList.findMany({
      where: { business_id: businessId },
      include: {
        _count: { select: { items: true } },
      },
      orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
    });
  }

  async getPriceList(businessId: string, id: string) {
    const priceList = await this.prisma.priceList.findFirst({
      where: { id, business_id: businessId },
      include: {
        items: {
          include: {
            variant: {
              select: {
                id: true,
                sku: true,
                barcode: true,
                retail_price: true,
                wholesale_price: true,
                product: { select: { id: true, name: true, code: true } },
                size: { select: { id: true, name: true, code: true } },
                color: { select: { id: true, name: true, code: true } },
              },
            },
          },
        },
      },
    });

    if (!priceList) {
      throw new NotFoundException(`Price list with ID "${id}" not found.`);
    }

    return priceList;
  }

  async updatePriceList(businessId: string, id: string, dto: UpdatePriceListDto) {
    const priceList = await this.getPriceList(businessId, id);

    if (dto.code) {
      const code = dto.code.trim().toUpperCase();
      const existing = await this.prisma.priceList.findFirst({
        where: {
          business_id: businessId,
          code,
          id: { not: id },
        },
      });
      if (existing) {
        throw new ConflictException(`Price list with code "${code}" already exists.`);
      }
    }

    if (dto.isDefault) {
      await this.prisma.priceList.updateMany({
        where: {
          business_id: businessId,
          type: dto.type || priceList.type,
          id: { not: id },
          is_default: true,
        },
        data: { is_default: false },
      });
    }

    return this.prisma.priceList.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.code ? { code: dto.code.trim().toUpperCase() } : {}),
        ...(dto.type ? { type: dto.type } : {}),
        ...(dto.isDefault !== undefined ? { is_default: dto.isDefault } : {}),
        ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}),
      },
    });
  }

  async setPriceListItem(businessId: string, priceListId: string, dto: SetPriceListItemDto) {
    await this.getPriceList(businessId, priceListId);

    const variant = await this.prisma.productVariant.findFirst({
      where: { id: dto.variantId, business_id: businessId, deleted_at: null },
    });
    if (!variant) {
      throw new NotFoundException(`Product variant with ID "${dto.variantId}" not found.`);
    }

    const item = await this.prisma.priceListItem.upsert({
      where: {
        price_list_id_product_variant_id: {
          price_list_id: priceListId,
          product_variant_id: dto.variantId,
        },
      },
      create: {
        price_list_id: priceListId,
        product_variant_id: dto.variantId,
        price: dto.price,
      },
      update: {
        price: dto.price,
      },
    });

    return {
      message: 'Price list item updated successfully',
      item,
    };
  }

  async removePriceListItem(businessId: string, priceListId: string, variantId: string) {
    await this.getPriceList(businessId, priceListId);

    const existing = await this.prisma.priceListItem.findUnique({
      where: {
        price_list_id_product_variant_id: {
          price_list_id: priceListId,
          product_variant_id: variantId,
        },
      },
    });

    if (!existing) {
      throw new NotFoundException('Variant is not part of this price list.');
    }

    await this.prisma.priceListItem.delete({
      where: {
        price_list_id_product_variant_id: {
          price_list_id: priceListId,
          product_variant_id: variantId,
        },
      },
    });

    return {
      message: 'Price list item removed successfully',
    };
  }

  /**
   * Price resolution helper: resolves the variant price based on active price lists
   * and falls back to default variant retail or wholesale price.
   */
  async getVariantPrice(
    variantId: string,
    saleType: PriceListType = PriceListType.RETAIL,
    priceListId?: string,
  ): Promise<number> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
    });

    if (!variant) {
      throw new NotFoundException(`Variant with ID "${variantId}" not found.`);
    }

    // 1. Direct explicit price list match
    if (priceListId) {
      const explicitItem = await this.prisma.priceListItem.findUnique({
        where: {
          price_list_id_product_variant_id: {
            price_list_id: priceListId,
            product_variant_id: variantId,
          },
        },
      });
      if (explicitItem) {
        return Number(explicitItem.price);
      }
    }

    // 2. Default active price list for this sale type
    const defaultPriceList = await this.prisma.priceList.findFirst({
      where: {
        business_id: variant.business_id,
        type: saleType,
        is_default: true,
        is_active: true,
      },
      include: {
        items: {
          where: { product_variant_id: variantId },
        },
      },
    });

    if (defaultPriceList && defaultPriceList.items.length > 0) {
      return Number(defaultPriceList.items[0].price);
    }

    // 3. Fallback to standard variant prices
    if (saleType === PriceListType.WHOLESALE) {
      return Number(variant.wholesale_price);
    }

    return Number(variant.retail_price);
  }
}
