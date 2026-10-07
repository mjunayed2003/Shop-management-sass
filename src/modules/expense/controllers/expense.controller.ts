import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
  ApiParam,
} from '@nestjs/swagger';
import { ExpenseService } from '../services/expense.service.js';
import {
  CreateExpenseDto,
  UpdateExpenseDto,
  ExpenseQueryDto,
} from '../dto/expense.dto.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { CurrentBranch } from '../../../common/decorators/current-branch.decorator.js';
import type { BranchContext } from '../../../common/decorators/current-branch.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { PrismaService } from '../../../prisma/prisma.service.js';

@ApiTags('Showroom Expenses')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-branch-id',
  required: true,
  description: 'Branch context UUID',
})
@Controller('api/v1/expenses')
export class ExpenseController {
  constructor(
    private readonly expenseService: ExpenseService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('expense.create')
  @ApiOperation({
    summary: 'Record showroom expense voucher with server-computed total and optional register drawer link',
  })
  @ApiResponse({ status: 201, description: 'Expense voucher created successfully' })
  async createExpense(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Body() dto: CreateExpenseDto,
  ) {
    const userRole = await this.resolveUserRole(user);
    return this.expenseService.createExpense(
      user.businessId,
      branchContext.branchId,
      user.id,
      dto,
      userRole,
    );
  }

  @Get('reports/summary')
  @RequirePermissions('report.view')
  @ApiOperation({
    summary: 'Expense reports summarized by category, branch, date range, and top vendors',
  })
  async getExpenseSummaryReport(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.expenseService.getExpenseSummaryReport(
      user.businessId,
      branchContext.branchId,
      branchContext.isAllBranchAdmin,
      startDate,
      endDate,
    );
  }

  @Get()
  @RequirePermissions('expense.view')
  @ApiOperation({ summary: 'List branch expenses with filters and pagination' })
  async getExpenseList(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Query() query: ExpenseQueryDto,
  ) {
    return this.expenseService.getExpenseList(
      user.businessId,
      branchContext.branchId,
      query,
      branchContext.isAllBranchAdmin,
    );
  }

  @Get(':id')
  @RequirePermissions('expense.view')
  @ApiOperation({ summary: 'Get full expense voucher details with attachments' })
  @ApiParam({ name: 'id', description: 'Expense UUID' })
  async getExpenseDetail(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id') expenseId: string,
  ) {
    return this.expenseService.getExpenseDetail(
      user.businessId,
      branchContext.branchId,
      expenseId,
      branchContext.isAllBranchAdmin,
    );
  }

  @Put(':id')
  @RequirePermissions('expense.update')
  @ApiOperation({ summary: 'Update expense voucher details' })
  @ApiParam({ name: 'id', description: 'Expense UUID' })
  async updateExpense(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id') expenseId: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    const userRole = await this.resolveUserRole(user);
    return this.expenseService.updateExpense(
      user.businessId,
      branchContext.branchId,
      user.id,
      expenseId,
      dto,
      userRole,
    );
  }

  @Delete(':id')
  @RequirePermissions('expense.delete')
  @ApiOperation({ summary: 'Delete expense voucher with audit log snapshot' })
  @ApiParam({ name: 'id', description: 'Expense UUID' })
  async deleteExpense(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id') expenseId: string,
  ) {
    return this.expenseService.deleteExpense(
      user.businessId,
      branchContext.branchId,
      user.id,
      expenseId,
    );
  }

  private async resolveUserRole(user: AuthenticatedUser) {
    if (user.isOwner) {
      return {
        code: 'OWNER',
        name: 'Business Owner',
        permissions: ['*'],
      };
    }

    if (user.roleId) {
      const role = await this.prisma.role.findUnique({
        where: { id: user.roleId },
        include: { role_permissions: { include: { permission: true } } },
      });

      if (role) {
        return {
          code: role.name,
          name: role.name,
          permissions: role.role_permissions.map((rp) => rp.permission.code),
        };
      }
    }

    return undefined;
  }
}
