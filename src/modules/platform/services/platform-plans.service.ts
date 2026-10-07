import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { Prisma } from '../../../generated/prisma/client.js';

export interface CreatePlanDto {
  name: string;
  code: string;
  description?: string;
  monthlyPrice: number;
  yearlyPrice: number;
  trialDays?: number;
  limits: {
    maxBranches?: number;
    maxUsers?: number;
    maxProducts?: number;
    maxVariants?: number;
    maxMonthlyInvoices?: number;
    hasApiAccess?: boolean;
    hasCustomReports?: boolean;
    hasOfflineSync?: boolean;
  };
}

@Injectable()
export class PlatformPlansService {
  constructor(private readonly prisma: PrismaService) {}

  async listPlans() {
    return this.prisma.plan.findMany({
      include: { limits: true },
      orderBy: { created_at: 'asc' },
    });
  }

  async createPlan(dto: CreatePlanDto) {
    const code = dto.code.trim().toUpperCase();
    const existing = await this.prisma.plan.findUnique({
      where: { code },
    });
    if (existing) {
      throw new ConflictException(`Plan with code "${code}" already exists.`);
    }

    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.plan.create({
        data: {
          name: dto.name,
          code,
          description: dto.description || null,
          monthly_price: new Prisma.Decimal(dto.monthlyPrice),
          yearly_price: new Prisma.Decimal(dto.yearlyPrice),
          trial_days: dto.trialDays ?? 30,
          is_active: true,
        },
      });

      const limits = await tx.planLimit.create({
        data: {
          plan_id: plan.id,
          max_branches: dto.limits.maxBranches ?? 1,
          max_users: dto.limits.maxUsers ?? 3,
          max_products: dto.limits.maxProducts ?? 500,
          max_variants: dto.limits.maxVariants ?? 1500,
          max_monthly_invoices: dto.limits.maxMonthlyInvoices ?? 1000,
          has_api_access: dto.limits.hasApiAccess ?? false,
          has_custom_reports: dto.limits.hasCustomReports ?? false,
          has_offline_sync: dto.limits.hasOfflineSync ?? true,
        },
      });

      return { ...plan, limits };
    });
  }

  async updatePlan(planId: string, dto: Partial<CreatePlanDto> & { isActive?: boolean }) {
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
      include: { limits: true },
    });
    if (!plan) {
      throw new NotFoundException('Plan not found.');
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedPlan = await tx.plan.update({
        where: { id: planId },
        data: {
          name: dto.name ?? plan.name,
          description: dto.description !== undefined ? dto.description : plan.description,
          monthly_price: dto.monthlyPrice !== undefined ? new Prisma.Decimal(dto.monthlyPrice) : plan.monthly_price,
          yearly_price: dto.yearlyPrice !== undefined ? new Prisma.Decimal(dto.yearlyPrice) : plan.yearly_price,
          trial_days: dto.trialDays ?? plan.trial_days,
          is_active: dto.isActive !== undefined ? dto.isActive : plan.is_active,
        },
      });

      if (dto.limits) {
        await tx.planLimit.update({
          where: { plan_id: planId },
          data: {
            max_branches: dto.limits.maxBranches ?? plan.limits?.max_branches,
            max_users: dto.limits.maxUsers ?? plan.limits?.max_users,
            max_products: dto.limits.maxProducts ?? plan.limits?.max_products,
            max_variants: dto.limits.maxVariants ?? plan.limits?.max_variants,
            max_monthly_invoices: dto.limits.maxMonthlyInvoices ?? plan.limits?.max_monthly_invoices,
            has_api_access: dto.limits.hasApiAccess ?? plan.limits?.has_api_access,
            has_custom_reports: dto.limits.hasCustomReports ?? plan.limits?.has_custom_reports,
            has_offline_sync: dto.limits.hasOfflineSync ?? plan.limits?.has_offline_sync,
          },
        });
      }

      return tx.plan.findUnique({
        where: { id: planId },
        include: { limits: true },
      });
    });
  }

  async deletePlan(planId: string) {
    const count = await this.prisma.subscription.count({
      where: { plan_id: planId },
    });
    if (count > 0) {
      throw new BadRequestException(
        `Cannot delete plan with active or historical subscriptions (${count} subscriptions exist). Please deactivate it instead.`,
      );
    }

    await this.prisma.plan.delete({
      where: { id: planId },
    });

    return { message: 'Plan deleted successfully.' };
  }
}
