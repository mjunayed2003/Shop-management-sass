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
import { PurchaseReturnService } from '../services/purchase-return.service.js';
import {
  CreatePurchaseReturnDto,
  PurchaseReturnQueryDto,
} from '../dto/purchase-return.dto.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { CurrentBranch } from '../../../common/decorators/current-branch.decorator.js';
import type { BranchContext } from '../../../common/decorators/current-branch.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '../../../common/constants/permissions.constant.js';

@ApiTags('Inventory: Purchase Returns')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-branch-id',
  required: true,
  description: 'Branch context UUID for purchase returns',
})
@Controller('api/v1/inventory/purchase-returns')
export class PurchaseReturnController {
  constructor(private readonly returnService: PurchaseReturnService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.PURCHASES_RETURN)
  @ApiOperation({
    summary: 'Create Purchase Return (DRAFT or COMPLETED; reduces stock and supplier balance)',
  })
  @ApiResponse({ status: 201, description: 'Purchase return created successfully' })
  async createReturn(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Body() dto: CreatePurchaseReturnDto,
  ) {
    return this.returnService.createReturn(
      user.businessId,
      branchContext.branchId,
      user.id,
      dto,
    );
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PURCHASES_READ)
  @ApiOperation({ summary: 'List Purchase Returns for current branch' })
  async listReturns(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Query() query: PurchaseReturnQueryDto,
  ) {
    return this.returnService.listReturns(
      user.businessId,
      branchContext.branchId,
      query,
    );
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PURCHASES_READ)
  @ApiOperation({ summary: 'Get Purchase Return detail' })
  @ApiParam({ name: 'id', description: 'Return UUID' })
  async getReturnById(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.returnService.getReturnById(
      user.businessId,
      branchContext.branchId,
      id,
    );
  }

  @Post(':id/complete')
  @RequirePermissions(PERMISSIONS.PURCHASES_RETURN)
  @ApiOperation({ summary: 'Complete DRAFT Purchase Return (Triggers stock-out and balance deduction)' })
  @ApiParam({ name: 'id', description: 'Return UUID' })
  async completeReturn(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.returnService.completeReturn(
      user.businessId,
      branchContext.branchId,
      user.id,
      id,
    );
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.PURCHASES_RETURN)
  @ApiOperation({ summary: 'Cancel DRAFT Purchase Return' })
  @ApiParam({ name: 'id', description: 'Return UUID' })
  async cancelReturn(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.returnService.cancelReturn(
      user.businessId,
      branchContext.branchId,
      id,
    );
  }
}
