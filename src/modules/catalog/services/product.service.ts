import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { VariantService } from './variant.service.js';
import { CreateProductDto } from '../dto/create-product.dto.js';
import { UpdateProductDto } from '../dto/update-product.dto.js';
import { ProductQueryDto } from '../dto/product-query.dto.js';
import type { Prisma } from '../../../generated/prisma/client.js';

@Injectable()
export class ProductService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly variantService: VariantService,
  ) {}

  async createProduct(
    businessId: string,
    currentBranchId: string,
    userId: string,
    isAllBranchAdmin: boolean,
    dto: CreateProductDto,
  ) {
    const code = dto.code.trim().toUpperCase();

    // 1. Verify product code uniqueness in business
    const existing = await this.prisma.product.findUnique({
      where: {
        business_id_code: {
          business_id: businessId,
          code,
        },
      },
    });

    if (existing && existing.deleted_at === null) {
      throw new ConflictException(`Product with code "${code}" already exists in your business.`);
    }

    // 2. Validate master data foreign keys
    const category = await this.prisma.category.findFirst({
      where: { id: dto.categoryId, business_id: businessId, deleted_at: null },
    });
    if (!category) {
      throw new NotFoundException(`Category with ID "${dto.categoryId}" not found.`);
    }

    if (dto.brandId) {
      const brand = await this.prisma.brand.findFirst({
        where: { id: dto.brandId, business_id: businessId, deleted_at: null },
      });
      if (!brand) {
        throw new NotFoundException(`Brand with ID "${dto.brandId}" not found.`);
      }
    }

    if (dto.seasonId) {
      const season = await this.prisma.season.findFirst({
        where: { id: dto.seasonId, business_id: businessId, deleted_at: null },
      });
      if (!season) {
        throw new NotFoundException(`Season with ID "${dto.seasonId}" not found.`);
      }
    }

    const unit = await this.prisma.unit.findFirst({
      where: { id: dto.unitId, OR: [{ business_id: businessId }, { business_id: null }] },
    });
    if (!unit) {
      throw new NotFoundException(`Unit with ID "${dto.unitId}" not found.`);
    }

    // 3. Determine target branches
    const targetBranchIds = new Set<string>([currentBranchId]);
    if (dto.branchIds && dto.branchIds.length > 0) {
      if (!isAllBranchAdmin) {
        throw new BadRequestException('Only business owners and admins may assign products to multiple branches.');
      }
      for (const bId of dto.branchIds) {
        const b = await this.prisma.branch.findFirst({
          where: { id: bId, business_id: businessId, deleted_at: null, is_active: true },
        });
        if (!b) {
          throw new NotFoundException(`Branch with ID "${bId}" not found in your business.`);
        }
        targetBranchIds.add(bId);
      }
    }

    const branchIdsList = Array.from(targetBranchIds);

    // 4. Create Product, ProductBranch records, and Variants inside ONE transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          business_id: businessId,
          name: dto.name.trim(),
          code,
          category_id: dto.categoryId,
          brand_id: dto.brandId || null,
          season_id: dto.seasonId || null,
          unit_id: dto.unitId,
          gender: dto.gender || 'UNISEX',
          fabric: dto.fabric?.trim() || null,
          description: dto.description?.trim() || null,
          has_variants: dto.hasVariants ?? true,
          track_individually: dto.trackIndividually ?? false,
          is_active: true,
          created_by: userId,
        },
      });

      // Insert ProductBranch rows
      await tx.productBranch.createMany({
        data: branchIdsList.map((branchId) => ({
          business_id: businessId,
          product_id: product.id,
          branch_id: branchId,
          is_active: true,
        })),
      });

      // Create variants
      const createdVariants: any[] = [];
      const variantsInput = dto.variants && dto.variants.length > 0 ? dto.variants : [
        {
          sku: code,
          retailPrice: 0,
          wholesalePrice: 0,
          costPrice: 0,
          reorderLevel: 5,
        },
      ];

      for (const vInput of variantsInput) {
        let sizeCode: string | undefined;
        if (vInput.sizeId) {
          const s = await tx.size.findFirst({
            where: { id: vInput.sizeId, OR: [{ business_id: businessId }, { business_id: null }] },
          });
          sizeCode = s?.code;
        }

        let colorCode: string | undefined;
        if (vInput.colorId) {
          const c = await tx.color.findFirst({
            where: { id: vInput.colorId, OR: [{ business_id: businessId }, { business_id: null }] },
          });
          colorCode = c?.code;
        }

        const sku = (vInput.sku || this.variantService.generateSku(code, sizeCode, colorCode)).trim().toUpperCase();

        let barcode = vInput.barcode?.trim();
        if (!barcode) {
          // generate random 12-digit numeric barcode
          const rand = Math.floor(1000000000 + Math.random() * 9000000000).toString();
          barcode = `88${rand}`;
        }

        // Verify SKU uniqueness
        const skuExists = await tx.productVariant.findUnique({
          where: { business_id_sku: { business_id: businessId, sku } },
        });
        if (skuExists) {
          throw new ConflictException(`Variant with SKU "${sku}" already exists.`);
        }

        // Verify Barcode uniqueness
        const barcodeExists = await tx.productVariant.findUnique({
          where: { business_id_barcode: { business_id: businessId, barcode } },
        });
        if (barcodeExists) {
          throw new ConflictException(`Variant with barcode "${barcode}" already exists.`);
        }

        const variant = await tx.productVariant.create({
          data: {
            business_id: businessId,
            product_id: product.id,
            size_id: vInput.sizeId || null,
            color_id: vInput.colorId || null,
            sku,
            barcode,
            retail_price: vInput.retailPrice,
            wholesale_price: vInput.wholesalePrice ?? 0,
            cost_price: vInput.costPrice ?? 0,
            reorder_level: vInput.reorderLevel ?? 5,
            is_active: true,
          },
        });

        // Initialize StockBalance for each branch
        await tx.stockBalance.createMany({
          data: branchIdsList.map((branchId) => ({
            business_id: businessId,
            branch_id: branchId,
            product_variant_id: variant.id,
            quantity: 0,
            allocated_quantity: 0,
            avg_cost_price: vInput.costPrice ?? 0,
            total_cost_value: 0,
          })),
        });

        createdVariants.push(variant);
      }

      return { product, variants: createdVariants };
    });

    return {
      message: 'Product and variants created successfully.',
      product: result.product,
      variantsCount: result.variants.length,
      assignedBranches: branchIdsList,
    };
  }

  async listProducts(
    businessId: string,
    currentBranchId: string,
    isAllBranchAdmin: boolean,
    query: ProductQueryDto,
  ) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;
    const skip = (page - 1) * limit;

    // Build filter conditions
    const where: Prisma.ProductWhereInput = {
      business_id: businessId,
      deleted_at: null,
      ...(query.categoryId ? { category_id: query.categoryId } : {}),
      ...(query.brandId ? { brand_id: query.brandId } : {}),
      ...(query.seasonId ? { season_id: query.seasonId } : {}),
      ...(query.gender ? { gender: query.gender } : {}),
      ...(query.isActive !== undefined ? { is_active: query.isActive } : {}),
    };

    // Business Rule 3: Branch visibility rule
    if (!isAllBranchAdmin) {
      // Branch user -> ONLY products with active ProductBranch for their branch
      where.branches = {
        some: {
          branch_id: currentBranchId,
          is_active: true,
        },
      };
    } else if (query.branchId) {
      // Admin filter by specific branch
      where.branches = {
        some: {
          branch_id: query.branchId,
          is_active: true,
        },
      };
    }

    // Search filter across name, code, variant SKU, or barcode
    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { code: { contains: term, mode: 'insensitive' } },
        {
          variants: {
            some: {
              OR: [
                { sku: { contains: term, mode: 'insensitive' } },
                { barcode: { contains: term } },
              ],
              deleted_at: null,
            },
          },
        },
      ];
    }

    const orderBy: Prisma.ProductOrderByWithRelationInput = {};
    const sortField = query.sortBy || 'created_at';
    const sortDirection = query.sortOrder || 'desc';
    (orderBy as any)[sortField] = sortDirection;

    const [total, products] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          category: { select: { id: true, name: true, code: true } },
          brand: { select: { id: true, name: true, code: true } },
          season: { select: { id: true, name: true, code: true } },
          unit: { select: { id: true, name: true, code: true } },
          branches: {
            include: {
              branch: { select: { id: true, name: true, code: true } },
            },
          },
          variants: {
            where: { deleted_at: null },
            include: {
              size: { select: { id: true, name: true, code: true } },
              color: { select: { id: true, name: true, code: true, hex_code: true } },
              stock_balances: {
                where: { branch_id: currentBranchId },
                select: { quantity: true, allocated_quantity: true, avg_cost_price: true },
              },
            },
          },
        },
      }),
    ]);

    // Format output with branch array and stock quantity for the current branch
    const formattedProducts = products.map((p) => {
      let totalCurrentBranchStock = 0;

      const formattedVariants = p.variants.map((v) => {
        const stockQty = Number(v.stock_balances[0]?.quantity || 0);
        totalCurrentBranchStock += stockQty;
        return {
          id: v.id,
          sku: v.sku,
          barcode: v.barcode,
          retailPrice: Number(v.retail_price),
          wholesalePrice: Number(v.wholesale_price),
          costPrice: Number(v.cost_price),
          reorderLevel: v.reorder_level,
          isActive: v.is_active,
          size: v.size,
          color: v.color,
          currentBranchStock: stockQty,
        };
      });

      return {
        id: p.id,
        name: p.name,
        code: p.code,
        gender: p.gender,
        fabric: p.fabric,
        description: p.description,
        hasVariants: p.has_variants,
        trackIndividually: p.track_individually,
        isActive: p.is_active,
        category: p.category,
        brand: p.brand,
        season: p.season,
        unit: p.unit,
        currentBranchStock: totalCurrentBranchStock,
        branches: p.branches.map((b) => ({
          branchId: b.branch_id,
          branchName: b.branch.name,
          branchCode: b.branch.code,
          isActive: b.is_active,
        })),
        variants: formattedVariants,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      };
    });

    return {
      data: formattedProducts,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getProduct(
    businessId: string,
    currentBranchId: string,
    isAllBranchAdmin: boolean,
    productId: string,
  ) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        business_id: businessId,
        deleted_at: null,
      },
      include: {
        category: true,
        brand: true,
        season: true,
        unit: true,
        branches: {
          include: {
            branch: { select: { id: true, name: true, code: true } },
          },
        },
        variants: {
          where: { deleted_at: null },
          include: {
            size: true,
            color: true,
            stock_balances: {
              where: { branch_id: currentBranchId },
              select: { quantity: true, allocated_quantity: true, avg_cost_price: true },
            },
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID "${productId}" not found.`);
    }

    // Branch visibility rule: branch users only see products active in their branch
    if (!isAllBranchAdmin) {
      const activeInCurrent = product.branches.some(
        (b) => b.branch_id === currentBranchId && b.is_active,
      );
      if (!activeInCurrent) {
        throw new NotFoundException(`Product with ID "${productId}" is not available in your branch.`);
      }
    }

    let totalCurrentBranchStock = 0;
    const formattedVariants = product.variants.map((v) => {
      const stock = Number(v.stock_balances[0]?.quantity || 0);
      totalCurrentBranchStock += stock;
      return {
        id: v.id,
        sku: v.sku,
        barcode: v.barcode,
        retailPrice: Number(v.retail_price),
        wholesalePrice: Number(v.wholesale_price),
        costPrice: Number(v.cost_price),
        reorderLevel: v.reorder_level,
        isActive: v.is_active,
        size: v.size,
        color: v.color,
        currentBranchStock: stock,
      };
    });

    return {
      id: product.id,
      name: product.name,
      code: product.code,
      gender: product.gender,
      fabric: product.fabric,
      description: product.description,
      hasVariants: product.has_variants,
      trackIndividually: product.track_individually,
      isActive: product.is_active,
      category: product.category,
      brand: product.brand,
      season: product.season,
      unit: product.unit,
      currentBranchStock: totalCurrentBranchStock,
      branches: product.branches.map((b) => ({
        branchId: b.branch_id,
        branchName: b.branch.name,
        branchCode: b.branch.code,
        isActive: b.is_active,
      })),
      variants: formattedVariants,
      createdAt: product.created_at,
      updatedAt: product.updated_at,
    };
  }

  async updateProduct(businessId: string, productId: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, business_id: businessId, deleted_at: null },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID "${productId}" not found.`);
    }

    if (dto.code) {
      const code = dto.code.trim().toUpperCase();
      const existing = await this.prisma.product.findFirst({
        where: {
          business_id: businessId,
          code,
          id: { not: productId },
          deleted_at: null,
        },
      });
      if (existing) {
        throw new ConflictException(`Product with code "${code}" already exists.`);
      }
    }

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.code ? { code: dto.code.trim().toUpperCase() } : {}),
        ...(dto.categoryId ? { category_id: dto.categoryId } : {}),
        ...(dto.brandId !== undefined ? { brand_id: dto.brandId || null } : {}),
        ...(dto.seasonId !== undefined ? { season_id: dto.seasonId || null } : {}),
        ...(dto.unitId ? { unit_id: dto.unitId } : {}),
        ...(dto.gender ? { gender: dto.gender } : {}),
        ...(dto.fabric !== undefined ? { fabric: dto.fabric?.trim() || null } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        ...(dto.hasVariants !== undefined ? { has_variants: dto.hasVariants } : {}),
        ...(dto.trackIndividually !== undefined ? { track_individually: dto.trackIndividually } : {}),
        ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}),
      },
    });

    return {
      message: 'Product updated successfully',
      product: updated,
    };
  }

  async deleteProduct(businessId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, business_id: businessId, deleted_at: null },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID "${productId}" not found.`);
    }

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      // Soft-delete product
      await tx.product.update({
        where: { id: productId },
        data: { deleted_at: now, is_active: false },
      });

      // Soft-delete variants
      await tx.productVariant.updateMany({
        where: { product_id: productId, deleted_at: null },
        data: { deleted_at: now, is_active: false },
      });

      // Deactivate branch associations
      await tx.productBranch.updateMany({
        where: { product_id: productId },
        data: { is_active: false },
      });
    });

    return {
      message: `Product "${product.name}" soft-deleted successfully.`,
    };
  }
}
