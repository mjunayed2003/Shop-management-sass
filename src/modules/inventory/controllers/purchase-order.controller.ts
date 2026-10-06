import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiHeader, ApiParam } from '@nestjs/swagger';
import { PurchaseOrderService } from '../services/purchase-order.service.js';
import {
  CreatePurchaseOrderDto,
  UpdatePurchaseOrderDto,
  PurchaseOrderQueryDto,
} from '../dto/purchase-order.dto.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { CurrentBranch } from '../../../common/decorators/current-branch.decorator.js';
import type { BranchContext } from '../../../common/decorators/current-branch.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '../../../common/constants/permissions.constant.js';

@ApiTags('Inventory: Purchase Orders')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-branch-id',
  required: true,
  description: 'Branch context UUID for purchase order management',
})
@Controller('api/v1/inventory/purchase-orders')
export class PurchaseOrderController {
  constructor(private readonly purchaseOrderService: PurchaseOrderService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.PURCHASES_CREATE)
  @ApiOperation({ summary: 'Create Purchase Order (DRAFT with sequential po_no)' })
  @ApiResponse({ status: 201, description: 'Purchase Order created successfully' })
  async createPurchaseOrder(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Body() dto: CreatePurchaseOrderDto,
  ) {
    return this.purchaseOrderService.createPurchaseOrder(
      user.businessId,
      branchContext.branchId,
      user.id,
      dto,
    );
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PURCHASES_READ)
  @ApiOperation({ summary: 'List Purchase Orders for current branch' })
  async listPurchaseOrders(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Query() query: PurchaseOrderQueryDto,
  ) {
    return this.purchaseOrderService.listPurchaseOrders(
      user.businessId,
      branchContext.branchId,
      query,
    );
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PURCHASES_READ)
  @ApiOperation({ summary: 'Get Purchase Order detail' })
  @ApiParam({ name: 'id', description: 'Purchase Order UUID' })
  async getPurchaseOrderById(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.purchaseOrderService.getPurchaseOrderById(
      user.businessId,
      branchContext.branchId,
      id,
    );
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PURCHASES_CREATE)
  @ApiOperation({ summary: 'Update Purchase Order (Allowed ONLY in DRAFT status)' })
  @ApiParam({ name: 'id', description: 'Purchase Order UUID' })
  async updatePurchaseOrder(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseOrderDto,
  ) {
    return this.purchaseOrderService.updatePurchaseOrder(
      user.businessId,
      branchContext.branchId,
      id,
      dto,
    );
  }

  @Post(':id/issue')
  @RequirePermissions(PERMISSIONS.PURCHASES_CREATE)
  @ApiOperation({ summary: 'Issue Purchase Order (Transition DRAFT -> ISSUED)' })
  @ApiParam({ name: 'id', description: 'Purchase Order UUID' })
  async issuePurchaseOrder(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.purchaseOrderService.issuePurchaseOrder(
      user.businessId,
      branchContext.branchId,
      id,
    );
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.PURCHASES_CREATE)
  @ApiOperation({ summary: 'Cancel Purchase Order (Allowed if 0 received)' })
  @ApiParam({ name: 'id', description: 'Purchase Order UUID' })
  async cancelPurchaseOrder(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.purchaseOrderService.cancelPurchaseOrder(
      user.businessId,
      branchContext.branchId,
      id,
    );
  }
}
