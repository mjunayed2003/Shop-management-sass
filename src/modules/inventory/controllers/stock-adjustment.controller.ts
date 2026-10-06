import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiHeader, ApiParam } from '@nestjs/swagger';
import { StockAdjustmentService } from '../services/stock-adjustment.service.js';
import {
  CreateStockAdjustmentDto,
  StockAdjustmentQueryDto,
} from '../dto/stock-adjustment.dto.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { CurrentBranch } from '../../../common/decorators/current-branch.decorator.js';
import type { BranchContext } from '../../../common/decorators/current-branch.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '../../../common/constants/permissions.constant.js';

@ApiTags('Inventory: Stock Adjustments')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-branch-id',
  required: true,
  description: 'Branch context UUID for stock adjustment operations',
})
@Controller('api/v1/inventory/adjustments')
export class StockAdjustmentController {
  constructor(private readonly adjustmentService: StockAdjustmentService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @ApiOperation({
    summary: 'Create Stock Adjustment (DRAFT; stores snapshots, NO stock balance changes until approved)',
  })
  @ApiResponse({ status: 201, description: 'Stock adjustment draft created' })
  async createAdjustment(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Body() dto: CreateStockAdjustmentDto,
  ) {
    return this.adjustmentService.createAdjustment(
      user.businessId,
      branchContext.branchId,
      user.id,
      dto,
    );
  }

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'List Stock Adjustments for current branch' })
  async listAdjustments(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Query() query: StockAdjustmentQueryDto,
  ) {
    return this.adjustmentService.listAdjustments(
      user.businessId,
      branchContext.branchId,
      query,
    );
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'Get Stock Adjustment detail' })
  @ApiParam({ name: 'id', description: 'Adjustment UUID' })
  async getAdjustmentById(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adjustmentService.getAdjustmentById(
      user.businessId,
      branchContext.branchId,
      id,
    );
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.STOCK_APPROVE)
  @ApiOperation({
    summary: 'Approve Stock Adjustment (Requires stock.approve; creator cannot approve unless owner; applies movements)',
  })
  @ApiParam({ name: 'id', description: 'Adjustment UUID' })
  async approveAdjustment(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adjustmentService.approveAdjustment(
      user.businessId,
      branchContext.branchId,
      user.id,
      user.isOwner,
      id,
    );
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @ApiOperation({ summary: 'Cancel DRAFT Stock Adjustment' })
  @ApiParam({ name: 'id', description: 'Adjustment UUID' })
  async cancelAdjustment(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adjustmentService.cancelAdjustment(
      user.businessId,
      branchContext.branchId,
      id,
    );
  }
}
