import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  BusinessStatus,
  SubscriptionStatus,
  AuditAction,
  Prisma,
} from '../../../generated/prisma/client.js';

export interface CreateOverrideDto {
  businessId: string;
  customMonthlyPrice?: number;
  customYearlyPrice?: number;
  discountPercentage?: number;
  isFreeAccess?: boolean;
  overrideMaxBranches?: number;
  overrideMaxUsers?: number;
  overrideMaxProducts?: number;
  overrideMaxVariants?: number;
  trialExtendedDays?: number;
  validUntil?: string;
  reason: string;
}

@Injectable()
export class PlatformBusinessesService {
  constructor(private readonly prisma: PrismaService) {}

  async listBusinesses(query: {
    page?: number;
    limit?: number;
    search?: string;
    status?: BusinessStatus;
    subscriptionStatus?: SubscriptionStatus;
  }) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { deleted_at: null };
    if (query.status) where.status = query.status;
    if (query.subscriptionStatus) {
      where.subscription = { status: query.subscriptionStatus };
    }
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { slug: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [businesses, total] = await Promise.all([
      this.prisma.business.findMany({
        where,
        include: {
          subscription: {
            include: { plan: { select: { name: true, code: true } } },
          },
          _count: {
            select: {
              branches: true,
              users: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.business.count({ where }),
    ]);

    return {
      data: businesses,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getBusinessDetail(businessId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      include: {
        subscription: {
          include: {
            plan: { include: { limits: true } },
          },
        },
        branches: {
          where: { deleted_at: null },
          select: { id: true, name: true, code: true, is_main: true, is_active: true },
        },
        users: {
          where: { deleted_at: null },
          select: { id: true, first_name: true, last_name: true, email: true, phone: true, is_owner: true, is_active: true },
        },
        subscription_overrides: {
          orderBy: { created_at: 'desc' },
        },
      },
    });

    if (!business) {
      throw new NotFoundException('Business not found.');
    }

    const [productCount, variantCount, saleCount] = await Promise.all([
      this.prisma.product.count({ where: { business_id: businessId, deleted_at: null } }),
      this.prisma.productVariant.count({ where: { product: { business_id: businessId, deleted_at: null } } }),
      this.prisma.sale.count({ where: { business_id: businessId } }),
    ]);

    return {
      business,
      usage: {
        products: productCount,
        variants: variantCount,
        salesTotal: saleCount,
      },
    };
  }

  async suspendBusiness(adminId: string, businessId: string, reason: string) {
    if (!reason || !reason.trim()) {
      throw new BadRequestException('A reason is mandatory to suspend a business.');
    }

    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
    });
    if (!business) {
      throw new NotFoundException('Business not found.');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.business.update({
        where: { id: businessId },
        data: {
          status: BusinessStatus.SUSPENDED,
          is_active: false,
        },
      });

      await tx.auditLog.create({
        data: {
          business_id: businessId,
          action: AuditAction.UPDATE,
          entity_table: 'businesses',
          entity_id: businessId,
          old_values: { status: business.status, is_active: business.is_active },
          new_values: { status: BusinessStatus.SUSPENDED, is_active: false, reason, suspendedBy: adminId },
        },
      });

      return {
        message: 'Business suspended successfully.',
        business: updated,
      };
    });
  }

  async reactivateBusiness(adminId: string, businessId: string, reason: string) {
    if (!reason || !reason.trim()) {
      throw new BadRequestException('A reason is mandatory to reactivate a business.');
    }

    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
    });
    if (!business) {
      throw new NotFoundException('Business not found.');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.business.update({
        where: { id: businessId },
        data: {
          status: BusinessStatus.ACTIVE,
          is_active: true,
        },
      });

      await tx.auditLog.create({
        data: {
          business_id: businessId,
          action: AuditAction.UPDATE,
          entity_table: 'businesses',
          entity_id: businessId,
          old_values: { status: business.status, is_active: business.is_active },
          new_values: { status: BusinessStatus.ACTIVE, is_active: true, reason, reactivatedBy: adminId },
        },
      });

      return {
        message: 'Business reactivated successfully.',
        business: updated,
      };
    });
  }

  async createSubscriptionOverride(adminId: string, dto: CreateOverrideDto) {
    if (!dto.reason || !dto.reason.trim()) {
      throw new BadRequestException('A reason is mandatory to create a subscription override.');
    }

    const business = await this.prisma.business.findUnique({
      where: { id: dto.businessId },
    });
    if (!business) {
      throw new NotFoundException('Business not found.');
    }

    return this.prisma.$transaction(async (tx) => {
      const override = await tx.subscriptionOverride.create({
        data: {
          business_id: dto.businessId,
          super_admin_id: adminId,
          custom_monthly_price: dto.customMonthlyPrice !== undefined ? new Prisma.Decimal(dto.customMonthlyPrice) : null,
          custom_yearly_price: dto.customYearlyPrice !== undefined ? new Prisma.Decimal(dto.customYearlyPrice) : null,
          discount_percentage: dto.discountPercentage !== undefined ? new Prisma.Decimal(dto.discountPercentage) : null,
          is_free_access: dto.isFreeAccess || false,
          override_max_branches: dto.overrideMaxBranches || null,
          override_max_users: dto.overrideMaxUsers || null,
          override_max_products: dto.overrideMaxProducts || null,
          override_max_variants: dto.overrideMaxVariants || null,
          trial_extended_days: dto.trialExtendedDays || null,
          valid_until: dto.validUntil ? new Date(dto.validUntil) : null,
          reason: dto.reason,
        },
      });

      await tx.auditLog.create({
        data: {
          business_id: dto.businessId,
          action: AuditAction.CREATE,
          entity_table: 'subscription_overrides',
          entity_id: override.id,
          new_values: { ...dto, createdByAdmin: adminId },
        },
      });

      return override;
    });
  }

  async expireSubscriptionOverride(adminId: string, overrideId: string) {
    const override = await this.prisma.subscriptionOverride.findUnique({
      where: { id: overrideId },
    });
    if (!override) {
      throw new NotFoundException('Subscription override not found.');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.subscriptionOverride.update({
        where: { id: overrideId },
        data: { valid_until: new Date() },
      });

      await tx.auditLog.create({
        data: {
          business_id: override.business_id,
          action: AuditAction.UPDATE,
          entity_table: 'subscription_overrides',
          entity_id: overrideId,
          new_values: { valid_until: new Date(), expiredByAdmin: adminId },
        },
      });

      return updated;
    });
  }
}
