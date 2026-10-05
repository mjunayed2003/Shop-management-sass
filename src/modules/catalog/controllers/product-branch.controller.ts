import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ProductBranchService } from '../services/product-branch.service.js';
import {
  ActivateProductBranchDto,
  DeactivateProductBranchDto,
} from '../dto/product-branch.dto.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { OptionalBranch } from '../../../common/decorators/optional-branch.decorator.js';

@ApiTags('Catalog: Product-Branch Management')
@ApiBearerAuth()
@OptionalBranch()
@Controller('api/v1/catalog/product-branches')
export class ProductBranchController {
  constructor(private readonly productBranchService: ProductBranchService) {}

  @Post('activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Activate a product in another branch (Admin only)',
    description:
      'Creates or reactivates a ProductBranch record and ensures initial StockBalance rows exist for all variants in that branch.',
  })
  @ApiResponse({ status: 200, description: 'Product activated in branch successfully' })
  @ApiResponse({ status: 403, description: 'Only business owners and admins may manage branch assignments' })
  async activateProductInBranch(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ActivateProductBranchDto,
  ) {
    if (!user.isOwner) {
      throw new ForbiddenException('Only business owners and admins can assign products to other branches.');
    }
    return this.productBranchService.activateProductInBranch(
      user.businessId,
      dto.productId,
      dto.branchId,
    );
  }

  @Post('deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Deactivate a product in a branch (Admin only)',
    description:
      'Deactivates a product in a specific branch. Enforces critical business rule: blocks deactivation if branch still has stock (StockBalance.quantity > 0) unless force=true.',
  })
  @ApiResponse({ status: 200, description: 'Product deactivated in branch successfully' })
  @ApiResponse({ status: 400, description: 'Blocked due to remaining stock without force=true' })
  @ApiResponse({ status: 403, description: 'Only business owners and admins may manage branch assignments' })
  async deactivateProductInBranch(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DeactivateProductBranchDto,
  ) {
    if (!user.isOwner) {
      throw new ForbiddenException('Only business owners and admins can deactivate products in branches.');
    }
    return this.productBranchService.deactivateProductInBranch(
      user.businessId,
      dto.productId,
      dto.branchId,
      dto.force,
    );
  }
}
