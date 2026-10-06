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
import { PurchaseService } from '../services/purchase.service.js';
import { CreatePurchaseDto, PurchaseQueryDto } from '../dto/purchase.dto.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { CurrentBranch } from '../../../common/decorators/current-branch.decorator.js';
import type { BranchContext } from '../../../common/decorators/current-branch.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '../../../common/constants/permissions.constant.js';

@ApiTags('Inventory: Purchases')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-branch-id',
  required: true,
  description: 'Branch context UUID for goods receipt purchase management',
})
@Controller('api/v1/inventory/purchases')
export class PurchaseController {
  constructor(private readonly purchaseService: PurchaseService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.PURCHASES_CREATE)
  @ApiOperation({
    summary: 'Receive Goods Purchase (Single Transaction with Stock, Landed Cost, ProductUnits, Supplier Balance)',
  })
  @ApiResponse({ status: 201, description: 'Purchase received successfully' })
  async createPurchase(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Body() dto: CreatePurchaseDto,
  ) {
    return this.purchaseService.createPurchase(
      user.businessId,
      branchContext.branchId,
      user.id,
      dto,
    );
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PURCHASES_READ)
  @ApiOperation({ summary: 'List Purchases for current branch' })
  async listPurchases(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Query() query: PurchaseQueryDto,
  ) {
    return this.purchaseService.listPurchases(
      user.businessId,
      branchContext.branchId,
      query,
    );
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PURCHASES_READ)
  @ApiOperation({ summary: 'Get Purchase detail with items, payments, and product units' })
  @ApiParam({ name: 'id', description: 'Purchase UUID' })
  async getPurchaseById(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.purchaseService.getPurchaseById(
      user.businessId,
      branchContext.branchId,
      id,
    );
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.PURCHASES_CREATE)
  @ApiOperation({
    summary: 'Cancel Purchase (Validated against sold stock and ProductUnits; reverses stock movements and supplier balance)',
  })
  @ApiParam({ name: 'id', description: 'Purchase UUID' })
  async cancelPurchase(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.purchaseService.cancelPurchase(
      user.businessId,
      branchContext.branchId,
      user.id,
      id,
    );
  }
}
