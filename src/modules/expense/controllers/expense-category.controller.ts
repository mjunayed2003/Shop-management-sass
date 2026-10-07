import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { ExpenseCategoryService } from '../services/expense-category.service.js';
import {
  CreateExpenseCategoryDto,
  UpdateExpenseCategoryDto,
} from '../dto/expense-category.dto.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';

@ApiTags('Expense Categories')
@ApiBearerAuth()
@Controller('api/v1/expenses/categories')
export class ExpenseCategoryController {
  constructor(
    private readonly expenseCategoryService: ExpenseCategoryService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('expense.create')
  @ApiOperation({ summary: 'Create business-wide expense category' })
  @ApiResponse({ status: 201, description: 'Category created' })
  async createCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateExpenseCategoryDto,
  ) {
    return this.expenseCategoryService.createCategory(user.businessId, dto);
  }

  @Get()
  @RequirePermissions('expense.view')
  @ApiOperation({ summary: 'List all business expense categories' })
  async getCategories(@CurrentUser() user: AuthenticatedUser) {
    return this.expenseCategoryService.getCategories(user.businessId);
  }

  @Get(':id')
  @RequirePermissions('expense.view')
  @ApiOperation({ summary: 'Get category by ID' })
  @ApiParam({ name: 'id', description: 'Category UUID' })
  async getCategoryById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.expenseCategoryService.getCategoryById(user.businessId, id);
  }

  @Put(':id')
  @RequirePermissions('expense.update')
  @ApiOperation({ summary: 'Update expense category' })
  @ApiParam({ name: 'id', description: 'Category UUID' })
  async updateCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateExpenseCategoryDto,
  ) {
    return this.expenseCategoryService.updateCategory(user.businessId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('expense.delete')
  @ApiOperation({ summary: 'Delete expense category if unreferenced' })
  @ApiParam({ name: 'id', description: 'Category UUID' })
  async deleteCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.expenseCategoryService.deleteCategory(user.businessId, id);
  }
}
