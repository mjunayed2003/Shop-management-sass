import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CreateVariantDto, UpdateVariantDto, BulkGenerateVariantsDto } from '../dto/variant.dto.js';

@Injectable()
export class VariantService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generates a standard SKU string: PRODCODE-SIZE-COLOR
   */
  generateSku(productCode: string, sizeCode?: string, colorCode?: string): string {
    const s = sizeCode ? sizeCode.replace(/[^A-Za-z0-9]/g, '') : 'STD';
    const c = colorCode ? colorCode.replace(/[^A-Za-z0-9]/g, '') : 'STD';
    return `${productCode.trim().toUpperCase()}-${s.toUpperCase()}-${c.toUpperCase()}`;
  }

  /**
   * Generates a unique 12-digit Code 128 / barcode string per business
   */
  async generateBarcode(businessId: string): Promise<string> {
    for (let attempts = 0; attempts < 15; attempts++) {
      // 12-digit numeric barcode (Code 128 compatible)
      const randomPart = Math.floor(1000000000 + Math.random() * 9000000000).toString();
      const prefix = '88'; // Retail prefix
      const candidate = `${prefix}${randomPart}`;

      const existing = await this.prisma.productVariant.findUnique({
        where: {
          business_id_barcode: {
            business_id: businessId,
            barcode: candidate,
          },
        },
      });

      if (!existing) {
        return candidate;
      }
    }
    // Fallback if collision
    return `BC${Date.now()}${Math.floor(Math.random() * 1000)}`;
  }

  async createVariant(businessId: string, productId: string, dto: CreateVariantDto) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, business_id: businessId, deleted_at: null },
      include: { branches: { where: { is_active: true } } },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID "${productId}" not found.`);
    }

    let sizeCode: string | undefined;
    if (dto.sizeId) {
      const size = await this.prisma.size.findFirst({
        where: { id: dto.sizeId, OR: [{ business_id: businessId }, { business_id: null }] },
      });
      if (!size) {
        throw new NotFoundException(`Size with ID "${dto.sizeId}" not found.`);
      }
      sizeCode = size.code;
    }

    let colorCode: string | undefined;
    if (dto.colorId) {
      const color = await this.prisma.color.findFirst({
        where: { id: dto.colorId, OR: [{ business_id: businessId }, { business_id: null }] },
      });
      if (!color) {
        throw new NotFoundException(`Color with ID "${dto.colorId}" not found.`);
      }
      colorCode = color.code;
    }

    // Determine SKU & Barcode
    const sku = (dto.sku || this.generateSku(product.code, sizeCode, colorCode)).trim().toUpperCase();
    const barcode = (dto.barcode || (await this.generateBarcode(businessId))).trim();

    // Enforce unique SKU & Barcode per business
    const existingSku = await this.prisma.productVariant.findUnique({
      where: { business_id_sku: { business_id: businessId, sku } },
    });
    if (existingSku && existingSku.deleted_at === null) {
      throw new ConflictException(`Variant with SKU "${sku}" already exists in your business.`);
    }

    const existingBarcode = await this.prisma.productVariant.findUnique({
      where: { business_id_barcode: { business_id: businessId, barcode } },
    });
    if (existingBarcode && existingBarcode.deleted_at === null) {
      throw new ConflictException(`Variant with Barcode "${barcode}" already exists in your business.`);
    }

    const warnings: string[] = [];
    if (dto.costPrice && dto.retailPrice < dto.costPrice) {
      warnings.push(`Warning: Retail price (${dto.retailPrice}) is lower than cost price (${dto.costPrice}).`);
    }

    const newVariant = await this.prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.create({
        data: {
          business_id: businessId,
          product_id: productId,
          size_id: dto.sizeId || null,
          color_id: dto.colorId || null,
          sku,
          barcode,
          retail_price: dto.retailPrice,
          wholesale_price: dto.wholesalePrice ?? 0,
          cost_price: dto.costPrice ?? 0,
          reorder_level: dto.reorderLevel ?? 5,
          is_active: true,
        },
        include: {
          size: true,
          color: true,
        },
      });

      // Initialize StockBalance for all active branches of this product
      for (const branch of product.branches) {
        await tx.stockBalance.upsert({
          where: {
            business_id_branch_id_product_variant_id: {
              business_id: businessId,
              branch_id: branch.branch_id,
              product_variant_id: variant.id,
            },
          },
          create: {
            business_id: businessId,
            branch_id: branch.branch_id,
            product_variant_id: variant.id,
            quantity: 0,
            allocated_quantity: 0,
            avg_cost_price: dto.costPrice ?? 0,
            total_cost_value: 0,
          },
          update: {},
        });
      }

      return variant;
    });

    return {
      message: 'Variant created successfully',
      variant: newVariant,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  async updateVariant(businessId: string, variantId: string, dto: UpdateVariantDto) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, business_id: businessId, deleted_at: null },
    });

    if (!variant) {
      throw new NotFoundException(`Variant with ID "${variantId}" not found.`);
    }

    if (dto.sku) {
      const sku = dto.sku.trim().toUpperCase();
      const existingSku = await this.prisma.productVariant.findFirst({
        where: {
          business_id: businessId,
          sku,
          id: { not: variantId },
          deleted_at: null,
        },
      });
      if (existingSku) {
        throw new ConflictException(`Variant with SKU "${sku}" already exists.`);
      }
    }

    if (dto.barcode) {
      const barcode = dto.barcode.trim();
      const existingBarcode = await this.prisma.productVariant.findFirst({
        where: {
          business_id: businessId,
          barcode,
          id: { not: variantId },
          deleted_at: null,
        },
      });
      if (existingBarcode) {
        throw new ConflictException(`Variant with Barcode "${barcode}" already exists.`);
      }
    }

    const retailPrice = dto.retailPrice ?? Number(variant.retail_price);
    const costPrice = dto.costPrice ?? Number(variant.cost_price);

    const warnings: string[] = [];
    if (retailPrice < costPrice) {
      warnings.push(`Warning: Retail price (${retailPrice}) is lower than cost price (${costPrice}).`);
    }

    const updated = await this.prisma.productVariant.update({
      where: { id: variantId },
      data: {
        ...(dto.sizeId !== undefined ? { size_id: dto.sizeId || null } : {}),
        ...(dto.colorId !== undefined ? { color_id: dto.colorId || null } : {}),
        ...(dto.sku ? { sku: dto.sku.trim().toUpperCase() } : {}),
        ...(dto.barcode ? { barcode: dto.barcode.trim() } : {}),
        ...(dto.retailPrice !== undefined ? { retail_price: dto.retailPrice } : {}),
        ...(dto.wholesalePrice !== undefined ? { wholesale_price: dto.wholesalePrice } : {}),
        ...(dto.costPrice !== undefined ? { cost_price: dto.costPrice } : {}),
        ...(dto.reorderLevel !== undefined ? { reorder_level: dto.reorderLevel } : {}),
        ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}),
      },
      include: {
        size: true,
        color: true,
      },
    });

    return {
      message: 'Variant updated successfully',
      variant: updated,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  async deactivateVariant(businessId: string, variantId: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, business_id: businessId, deleted_at: null },
    });

    if (!variant) {
      throw new NotFoundException(`Variant with ID "${variantId}" not found.`);
    }

    const updated = await this.prisma.productVariant.update({
      where: { id: variantId },
      data: { is_active: false },
    });

    return {
      message: 'Variant deactivated successfully',
      variant: updated,
    };
  }

  async bulkGenerateVariants(
    businessId: string,
    productId: string,
    dto: BulkGenerateVariantsDto,
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, business_id: businessId, deleted_at: null },
      include: {
        branches: { where: { is_active: true } },
        variants: { where: { deleted_at: null } },
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID "${productId}" not found.`);
    }

    if (dto.sizeIds.length === 0 || dto.colorIds.length === 0) {
      throw new BadRequestException('At least one size and one color must be provided for bulk generation.');
    }

    // Fetch all requested sizes and colors
    const sizes = await this.prisma.size.findMany({
      where: {
        id: { in: dto.sizeIds },
        OR: [{ business_id: businessId }, { business_id: null }],
      },
    });

    const colors = await this.prisma.color.findMany({
      where: {
        id: { in: dto.colorIds },
        OR: [{ business_id: businessId }, { business_id: null }],
      },
    });

    const sizeMap = new Map(sizes.map((s) => [s.id, s]));
    const colorMap = new Map(colors.map((c) => [c.id, c]));

    // Existing combinations set for fast lookup
    const existingCombos = new Set(
      product.variants.map((v) => `${v.size_id || 'null'}:${v.color_id || 'null'}`),
    );

    const createdVariantsList: any[] = [];
    const warnings: string[] = [];

    if (dto.defaultCostPrice && dto.defaultRetailPrice < dto.defaultCostPrice) {
      warnings.push(
        `Warning: Default retail price (${dto.defaultRetailPrice}) is lower than default cost price (${dto.defaultCostPrice}).`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      for (const sizeId of dto.sizeIds) {
        const size = sizeMap.get(sizeId);
        if (!size) continue;

        for (const colorId of dto.colorIds) {
          const color = colorMap.get(colorId);
          if (!color) continue;

          const key = `${sizeId}:${colorId}`;
          if (existingCombos.has(key)) {
            continue; // Skip already existing combination
          }

          const baseSku = this.generateSku(product.code, size.code, color.code);
          let candidateSku = baseSku;
          let counter = 1;

          while (true) {
            const exists = await tx.productVariant.findUnique({
              where: { business_id_sku: { business_id: businessId, sku: candidateSku } },
            });
            if (!exists) break;
            candidateSku = `${baseSku}-${counter++}`;
          }

          // Generate unique barcode
          let barcode = '';
          while (true) {
            const randomPart = Math.floor(1000000000 + Math.random() * 9000000000).toString();
            const candidate = `88${randomPart}`;
            const exists = await tx.productVariant.findUnique({
              where: { business_id_barcode: { business_id: businessId, barcode: candidate } },
            });
            if (!exists) {
              barcode = candidate;
              break;
            }
          }

          const variant = await tx.productVariant.create({
            data: {
              business_id: businessId,
              product_id: productId,
              size_id: size.id,
              color_id: color.id,
              sku: candidateSku,
              barcode,
              retail_price: dto.defaultRetailPrice,
              wholesale_price: dto.defaultWholesalePrice ?? 0,
              cost_price: dto.defaultCostPrice ?? 0,
              reorder_level: dto.defaultReorderLevel ?? 5,
              is_active: true,
            },
            include: {
              size: true,
              color: true,
            },
          });

          // Initialize StockBalance for all active branches of this product
          for (const branch of product.branches) {
            await tx.stockBalance.upsert({
              where: {
                business_id_branch_id_product_variant_id: {
                  business_id: businessId,
                  branch_id: branch.branch_id,
                  product_variant_id: variant.id,
                },
              },
              create: {
                business_id: businessId,
                branch_id: branch.branch_id,
                product_variant_id: variant.id,
                quantity: 0,
                allocated_quantity: 0,
                avg_cost_price: dto.defaultCostPrice ?? 0,
                total_cost_value: 0,
              },
              update: {},
            });
          }

          createdVariantsList.push(variant);
          existingCombos.add(key);
        }
      }
    });

    return {
      message: `Bulk generated ${createdVariantsList.length} variant(s) successfully.`,
      createdCount: createdVariantsList.length,
      variants: createdVariantsList,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }
}
