import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CreateCategoryDto, UpdateCategoryDto } from '../dto/category.dto.js';
import { CreateBrandDto, UpdateBrandDto } from '../dto/brand.dto.js';
import { CreateSeasonDto, UpdateSeasonDto } from '../dto/season.dto.js';
import { CreateSizeDto, UpdateSizeDto } from '../dto/size.dto.js';
import { CreateColorDto, UpdateColorDto } from '../dto/color.dto.js';
import { CreateUnitDto, UpdateUnitDto } from '../dto/unit.dto.js';

@Injectable()
export class MasterDataService {
  constructor(private readonly prisma: PrismaService) {}

  // ==========================================================================
  // CATEGORIES
  // ==========================================================================

  async createCategory(businessId: string, dto: CreateCategoryDto) {
    const code = dto.code.trim().toUpperCase();

    const existing = await this.prisma.category.findUnique({
      where: {
        business_id_code: {
          business_id: businessId,
          code,
        },
      },
    });

    if (existing && existing.deleted_at === null) {
      throw new ConflictException(`Category with code "${code}" already exists in your business.`);
    }

    if (dto.parentId) {
      const parent = await this.prisma.category.findFirst({
        where: { id: dto.parentId, business_id: businessId, deleted_at: null },
      });
      if (!parent) {
        throw new NotFoundException(`Parent category with ID "${dto.parentId}" not found.`);
      }
    }

    return this.prisma.category.create({
      data: {
        business_id: businessId,
        parent_id: dto.parentId || null,
        name: dto.name.trim(),
        code,
        description: dto.description?.trim() || null,
        is_active: true,
      },
    });
  }

  async listCategories(businessId: string, search?: string, includeInactive = false) {
    return this.prisma.category.findMany({
      where: {
        business_id: businessId,
        deleted_at: null,
        ...(includeInactive ? {} : { is_active: true }),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { code: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        parent: { select: { id: true, name: true, code: true } },
        _count: { select: { children: true, products: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getCategory(businessId: string, id: string) {
    const category = await this.prisma.category.findFirst({
      where: { id, business_id: businessId, deleted_at: null },
      include: {
        parent: true,
        children: { where: { deleted_at: null } },
        _count: { select: { products: true } },
      },
    });

    if (!category) {
      throw new NotFoundException(`Category with ID "${id}" not found.`);
    }

    return category;
  }

  async updateCategory(businessId: string, id: string, dto: UpdateCategoryDto) {
    await this.getCategory(businessId, id);

    if (dto.code) {
      const code = dto.code.trim().toUpperCase();
      const existing = await this.prisma.category.findFirst({
        where: {
          business_id: businessId,
          code,
          id: { not: id },
          deleted_at: null,
        },
      });
      if (existing) {
        throw new ConflictException(`Category with code "${code}" already exists.`);
      }
    }

    if (dto.parentId) {
      if (dto.parentId === id) {
        throw new BadRequestException('A category cannot be its own parent.');
      }
      const parent = await this.prisma.category.findFirst({
        where: { id: dto.parentId, business_id: businessId, deleted_at: null },
      });
      if (!parent) {
        throw new NotFoundException(`Parent category with ID "${dto.parentId}" not found.`);
      }
    }

    return this.prisma.category.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.code ? { code: dto.code.trim().toUpperCase() } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        ...(dto.parentId !== undefined ? { parent_id: dto.parentId || null } : {}),
        ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}),
      },
    });
  }

  async deleteCategory(businessId: string, id: string) {
    const category = await this.getCategory(businessId, id);

    // Business rule: block deleting a category that has children or products
    const activeChildren = await this.prisma.category.count({
      where: { parent_id: id, deleted_at: null },
    });
    if (activeChildren > 0) {
      throw new BadRequestException(
        `Cannot delete category "${category.name}" because it has ${activeChildren} active sub-category(ies). Please reassign or delete child categories first.`,
      );
    }

    const activeProducts = await this.prisma.product.count({
      where: { category_id: id, deleted_at: null },
    });
    if (activeProducts > 0) {
      throw new BadRequestException(
        `Cannot delete category "${category.name}" because it has ${activeProducts} active product(s) linked to it.`,
      );
    }

    // Soft delete
    return this.prisma.category.update({
      where: { id },
      data: { deleted_at: new Date(), is_active: false },
    });
  }

  // ==========================================================================
  // BRANDS
  // ==========================================================================

  async createBrand(businessId: string, dto: CreateBrandDto) {
    const code = dto.code.trim().toUpperCase();

    const existing = await this.prisma.brand.findUnique({
      where: {
        business_id_code: {
          business_id: businessId,
          code,
        },
      },
    });

    if (existing && existing.deleted_at === null) {
      throw new ConflictException(`Brand with code "${code}" already exists in your business.`);
    }

    return this.prisma.brand.create({
      data: {
        business_id: businessId,
        name: dto.name.trim(),
        code,
      },
    });
  }

  async listBrands(businessId: string, search?: string) {
    return this.prisma.brand.findMany({
      where: {
        business_id: businessId,
        deleted_at: null,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { code: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        _count: { select: { products: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getBrand(businessId: string, id: string) {
    const brand = await this.prisma.brand.findFirst({
      where: { id, business_id: businessId, deleted_at: null },
      include: { _count: { select: { products: true } } },
    });

    if (!brand) {
      throw new NotFoundException(`Brand with ID "${id}" not found.`);
    }

    return brand;
  }

  async updateBrand(businessId: string, id: string, dto: UpdateBrandDto) {
    await this.getBrand(businessId, id);

    if (dto.code) {
      const code = dto.code.trim().toUpperCase();
      const existing = await this.prisma.brand.findFirst({
        where: {
          business_id: businessId,
          code,
          id: { not: id },
          deleted_at: null,
        },
      });
      if (existing) {
        throw new ConflictException(`Brand with code "${code}" already exists.`);
      }
    }

    return this.prisma.brand.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.code ? { code: dto.code.trim().toUpperCase() } : {}),
      },
    });
  }

  async deleteBrand(businessId: string, id: string) {
    const brand = await this.getBrand(businessId, id);

    const activeProducts = await this.prisma.product.count({
      where: { brand_id: id, deleted_at: null },
    });
    if (activeProducts > 0) {
      throw new BadRequestException(
        `Cannot delete brand "${brand.name}" because it is currently assigned to ${activeProducts} active product(s).`,
      );
    }

    return this.prisma.brand.update({
      where: { id },
      data: { deleted_at: new Date() },
    });
  }

  // ==========================================================================
  // SEASONS
  // ==========================================================================

  async createSeason(businessId: string, dto: CreateSeasonDto) {
    const code = dto.code.trim().toUpperCase();

    const existing = await this.prisma.season.findUnique({
      where: {
        business_id_code: {
          business_id: businessId,
          code,
        },
      },
    });

    if (existing && existing.deleted_at === null) {
      throw new ConflictException(`Season with code "${code}" already exists in your business.`);
    }

    return this.prisma.season.create({
      data: {
        business_id: businessId,
        name: dto.name.trim(),
        code,
        start_date: dto.startDate ? new Date(dto.startDate) : null,
        end_date: dto.endDate ? new Date(dto.endDate) : null,
      },
    });
  }

  async listSeasons(businessId: string, search?: string) {
    return this.prisma.season.findMany({
      where: {
        business_id: businessId,
        deleted_at: null,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { code: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        _count: { select: { products: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async getSeason(businessId: string, id: string) {
    const season = await this.prisma.season.findFirst({
      where: { id, business_id: businessId, deleted_at: null },
      include: { _count: { select: { products: true } } },
    });

    if (!season) {
      throw new NotFoundException(`Season with ID "${id}" not found.`);
    }

    return season;
  }

  async updateSeason(businessId: string, id: string, dto: UpdateSeasonDto) {
    await this.getSeason(businessId, id);

    if (dto.code) {
      const code = dto.code.trim().toUpperCase();
      const existing = await this.prisma.season.findFirst({
        where: {
          business_id: businessId,
          code,
          id: { not: id },
          deleted_at: null,
        },
      });
      if (existing) {
        throw new ConflictException(`Season with code "${code}" already exists.`);
      }
    }

    return this.prisma.season.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.code ? { code: dto.code.trim().toUpperCase() } : {}),
        ...(dto.startDate !== undefined ? { start_date: dto.startDate ? new Date(dto.startDate) : null } : {}),
        ...(dto.endDate !== undefined ? { end_date: dto.endDate ? new Date(dto.endDate) : null } : {}),
      },
    });
  }

  async deleteSeason(businessId: string, id: string) {
    await this.getSeason(businessId, id);

    return this.prisma.season.update({
      where: { id },
      data: { deleted_at: new Date() },
    });
  }

  // ==========================================================================
  // SIZES (System & Tenant rows)
  // ==========================================================================

  async createSize(businessId: string, dto: CreateSizeDto) {
    const code = dto.code.trim().toUpperCase();

    const existing = await this.prisma.size.findUnique({
      where: {
        business_id_code: {
          business_id: businessId,
          code,
        },
      },
    });

    if (existing) {
      throw new ConflictException(`Size with code "${code}" already exists in your business.`);
    }

    return this.prisma.size.create({
      data: {
        business_id: businessId,
        name: dto.name.trim(),
        code,
        sort_order: dto.sortOrder ?? 0,
      },
    });
  }

  async listSizes(businessId: string) {
    return this.prisma.size.findMany({
      where: {
        OR: [{ business_id: businessId }, { business_id: null }],
      },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    });
  }

  async getSize(businessId: string, id: string) {
    const size = await this.prisma.size.findFirst({
      where: {
        id,
        OR: [{ business_id: businessId }, { business_id: null }],
      },
    });

    if (!size) {
      throw new NotFoundException(`Size with ID "${id}" not found.`);
    }

    return size;
  }

  async updateSize(businessId: string, id: string, dto: UpdateSizeDto) {
    const size = await this.getSize(businessId, id);

    // Business rule: System rows (business_id = null) can be read but not edited
    if (size.business_id === null) {
      throw new ForbiddenException('System master sizes cannot be modified.');
    }

    if (dto.code) {
      const code = dto.code.trim().toUpperCase();
      const existing = await this.prisma.size.findFirst({
        where: {
          business_id: businessId,
          code,
          id: { not: id },
        },
      });
      if (existing) {
        throw new ConflictException(`Size with code "${code}" already exists.`);
      }
    }

    return this.prisma.size.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.code ? { code: dto.code.trim().toUpperCase() } : {}),
        ...(dto.sortOrder !== undefined ? { sort_order: dto.sortOrder } : {}),
      },
    });
  }

  async deleteSize(businessId: string, id: string) {
    const size = await this.getSize(businessId, id);

    if (size.business_id === null) {
      throw new ForbiddenException('System master sizes cannot be deleted.');
    }

    const linkedVariants = await this.prisma.productVariant.count({
      where: { size_id: id, deleted_at: null },
    });
    if (linkedVariants > 0) {
      throw new BadRequestException(
        `Cannot delete size "${size.name}" because it is used by ${linkedVariants} product variant(s).`,
      );
    }

    return this.prisma.size.delete({ where: { id } });
  }

  // ==========================================================================
  // COLORS (System & Tenant rows)
  // ==========================================================================

  async createColor(businessId: string, dto: CreateColorDto) {
    const code = dto.code.trim().toUpperCase();

    const existing = await this.prisma.color.findUnique({
      where: {
        business_id_code: {
          business_id: businessId,
          code,
        },
      },
    });

    if (existing) {
      throw new ConflictException(`Color with code "${code}" already exists in your business.`);
    }

    return this.prisma.color.create({
      data: {
        business_id: businessId,
        name: dto.name.trim(),
        code,
        hex_code: dto.hexCode?.trim() || null,
      },
    });
  }

  async listColors(businessId: string) {
    return this.prisma.color.findMany({
      where: {
        OR: [{ business_id: businessId }, { business_id: null }],
      },
      orderBy: { name: 'asc' },
    });
  }

  async getColor(businessId: string, id: string) {
    const color = await this.prisma.color.findFirst({
      where: {
        id,
        OR: [{ business_id: businessId }, { business_id: null }],
      },
    });

    if (!color) {
      throw new NotFoundException(`Color with ID "${id}" not found.`);
    }

    return color;
  }

  async updateColor(businessId: string, id: string, dto: UpdateColorDto) {
    const color = await this.getColor(businessId, id);

    if (color.business_id === null) {
      throw new ForbiddenException('System master colors cannot be modified.');
    }

    if (dto.code) {
      const code = dto.code.trim().toUpperCase();
      const existing = await this.prisma.color.findFirst({
        where: {
          business_id: businessId,
          code,
          id: { not: id },
        },
      });
      if (existing) {
        throw new ConflictException(`Color with code "${code}" already exists.`);
      }
    }

    return this.prisma.color.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.code ? { code: dto.code.trim().toUpperCase() } : {}),
        ...(dto.hexCode !== undefined ? { hex_code: dto.hexCode?.trim() || null } : {}),
      },
    });
  }

  async deleteColor(businessId: string, id: string) {
    const color = await this.getColor(businessId, id);

    if (color.business_id === null) {
      throw new ForbiddenException('System master colors cannot be deleted.');
    }

    const linkedVariants = await this.prisma.productVariant.count({
      where: { color_id: id, deleted_at: null },
    });
    if (linkedVariants > 0) {
      throw new BadRequestException(
        `Cannot delete color "${color.name}" because it is used by ${linkedVariants} product variant(s).`,
      );
    }

    return this.prisma.color.delete({ where: { id } });
  }

  // ==========================================================================
  // UNITS (System & Tenant rows)
  // ==========================================================================

  async createUnit(businessId: string, dto: CreateUnitDto) {
    const code = dto.code.trim().toUpperCase();

    const existing = await this.prisma.unit.findUnique({
      where: {
        business_id_code: {
          business_id: businessId,
          code,
        },
      },
    });

    if (existing) {
      throw new ConflictException(`Unit with code "${code}" already exists in your business.`);
    }

    return this.prisma.unit.create({
      data: {
        business_id: businessId,
        name: dto.name.trim(),
        code,
        allow_decimal: dto.allowDecimal ?? false,
      },
    });
  }

  async listUnits(businessId: string) {
    return this.prisma.unit.findMany({
      where: {
        OR: [{ business_id: businessId }, { business_id: null }],
      },
      orderBy: { name: 'asc' },
    });
  }

  async getUnit(businessId: string, id: string) {
    const unit = await this.prisma.unit.findFirst({
      where: {
        id,
        OR: [{ business_id: businessId }, { business_id: null }],
      },
    });

    if (!unit) {
      throw new NotFoundException(`Unit with ID "${id}" not found.`);
    }

    return unit;
  }

  async updateUnit(businessId: string, id: string, dto: UpdateUnitDto) {
    const unit = await this.getUnit(businessId, id);

    if (unit.business_id === null) {
      throw new ForbiddenException('System master units cannot be modified.');
    }

    if (dto.code) {
      const code = dto.code.trim().toUpperCase();
      const existing = await this.prisma.unit.findFirst({
        where: {
          business_id: businessId,
          code,
          id: { not: id },
        },
      });
      if (existing) {
        throw new ConflictException(`Unit with code "${code}" already exists.`);
      }
    }

    return this.prisma.unit.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.code ? { code: dto.code.trim().toUpperCase() } : {}),
        ...(dto.allowDecimal !== undefined ? { allow_decimal: dto.allowDecimal } : {}),
      },
    });
  }

  async deleteUnit(businessId: string, id: string) {
    const unit = await this.getUnit(businessId, id);

    if (unit.business_id === null) {
      throw new ForbiddenException('System master units cannot be deleted.');
    }

    const linkedProducts = await this.prisma.product.count({
      where: { unit_id: id, deleted_at: null },
    });
    if (linkedProducts > 0) {
      throw new BadRequestException(
        `Cannot delete unit "${unit.name}" because it is currently assigned to ${linkedProducts} active product(s).`,
      );
    }

    return this.prisma.unit.delete({ where: { id } });
  }
}
