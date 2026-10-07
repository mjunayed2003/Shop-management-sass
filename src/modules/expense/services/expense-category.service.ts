import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  CreateExpenseCategoryDto,
  UpdateExpenseCategoryDto,
} from '../dto/expense-category.dto.js';

@Injectable()
export class ExpenseCategoryService {
  constructor(private readonly prisma: PrismaService) {}

  async createCategory(businessId: string, dto: CreateExpenseCategoryDto) {
    const existing = await this.prisma.expenseCategory.findUnique({
      where: {
        business_id_code: {
          business_id: businessId,
          code: dto.code.trim().toUpperCase(),
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Expense category code "${dto.code}" already exists for this business.`,
      );
    }

    return this.prisma.expenseCategory.create({
      data: {
        business_id: businessId,
        name: dto.name.trim(),
        code: dto.code.trim().toUpperCase(),
      },
    });
  }

  async getCategories(businessId: string) {
    return this.prisma.expenseCategory.findMany({
      where: { business_id: businessId },
      orderBy: { name: 'asc' },
    });
  }

  async getCategoryById(businessId: string, id: string) {
    const category = await this.prisma.expenseCategory.findFirst({
      where: { id, business_id: businessId },
    });

    if (!category) {
      throw new NotFoundException(`Expense category "${id}" not found.`);
    }

    return category;
  }

  async updateCategory(
    businessId: string,
    id: string,
    dto: UpdateExpenseCategoryDto,
  ) {
    await this.getCategoryById(businessId, id);

    return this.prisma.expenseCategory.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
      },
    });
  }

  async deleteCategory(businessId: string, id: string) {
    await this.getCategoryById(businessId, id);

    const expenseCount = await this.prisma.expense.count({
      where: { expense_category_id: id },
    });

    if (expenseCount > 0) {
      throw new BadRequestException(
        `Cannot delete category "${id}" because it is referenced by ${expenseCount} expense record(s).`,
      );
    }

    return this.prisma.expenseCategory.delete({
      where: { id },
    });
  }
}
