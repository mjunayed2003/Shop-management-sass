import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
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
import { HeldSaleService } from '../services/held-sale.service.js';
import { HoldCartDto } from '../dto/held-sale.dto.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { CurrentBranch } from '../../../common/decorators/current-branch.decorator.js';
import type { BranchContext } from '../../../common/decorators/current-branch.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';

@ApiTags('Sales: Held Carts')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-branch-id',
  required: true,
  description: 'Branch context UUID for held sales',
})
@Controller('api/v1/sales/held')
export class HeldSaleController {
  constructor(private readonly heldSaleService: HeldSaleService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('sale.create', 'sales:create', 'pos:access')
  @ApiOperation({ summary: 'Hold current POS cart without allocating stock' })
  @ApiResponse({ status: 201, description: 'Cart held successfully' })
  async holdCart(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Body() dto: HoldCartDto,
  ) {
    return this.heldSaleService.holdCart(
      user.businessId,
      branchContext.branchId,
      user.id,
      dto,
    );
  }

  @Get()
  @RequirePermissions('sale.read', 'sales:read', 'pos:access')
  @ApiOperation({ summary: 'List unretrieved held sales for current branch' })
  async listHeldSales(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
  ) {
    return this.heldSaleService.listHeldSales(
      user.businessId,
      branchContext.branchId,
    );
  }

  @Post(':id/retrieve')
  @RequirePermissions('sale.create', 'sales:create', 'pos:access')
  @ApiOperation({
    summary: 'Retrieve held cart, mark retrieved, and re-price items with fresh catalog rates',
  })
  @ApiParam({ name: 'id', description: 'Held sale UUID' })
  async retrieveHeldSale(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.heldSaleService.retrieveHeldSale(
      user.businessId,
      branchContext.branchId,
      id,
    );
  }

  @Delete(':id')
  @RequirePermissions('sale.create', 'sales:create', 'pos:access')
  @ApiOperation({ summary: 'Delete a held sale' })
  @ApiParam({ name: 'id', description: 'Held sale UUID' })
  async deleteHeldSale(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.heldSaleService.deleteHeldSale(
      user.businessId,
      branchContext.branchId,
      id,
    );
  }
}
