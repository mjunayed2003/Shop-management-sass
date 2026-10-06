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
import { StockTransferService } from '../services/stock-transfer.service.js';
import {
  CreateStockTransferDto,
  ReceiveTransferDto,
  StockTransferQueryDto,
  InstantTransferDto,
} from '../dto/stock-transfer.dto.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { CurrentBranch } from '../../../common/decorators/current-branch.decorator.js';
import type { BranchContext } from '../../../common/decorators/current-branch.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '../../../common/constants/permissions.constant.js';

@ApiTags('Inventory: Stock Transfers')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-branch-id',
  required: true,
  description: 'Branch context UUID for stock transfer operations',
})
@Controller('api/v1/inventory/transfers')
export class StockTransferController {
  constructor(private readonly transferService: StockTransferService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  @ApiOperation({ summary: 'Initiate Stock Transfer (PENDING status; creates notification for destination branch)' })
  @ApiResponse({ status: 201, description: 'Stock transfer initiated' })
  async createTransfer(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Body() dto: CreateStockTransferDto,
  ) {
    return this.transferService.createTransfer(
      user.businessId,
      branchContext.branchId,
      user.id,
      dto,
    );
  }

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'List Stock Transfers involving current branch (sent or received)' })
  async listTransfers(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Query() query: StockTransferQueryDto,
  ) {
    return this.transferService.listTransfers(
      user.businessId,
      branchContext.branchId,
      query,
    );
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'Get Stock Transfer details' })
  @ApiParam({ name: 'id', description: 'Transfer UUID' })
  async getTransferById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.transferService.getTransferById(user.businessId, id);
  }

  @Post(':id/dispatch')
  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  @ApiOperation({
    summary: 'Dispatch Transfer (PENDING -> IN_TRANSIT; reduces source stock at source WAC, moves ProductUnits to IN_TRANSIT)',
  })
  @ApiParam({ name: 'id', description: 'Transfer UUID' })
  async dispatchTransfer(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.transferService.dispatchTransfer(
      user.businessId,
      branchContext.branchId,
      user.id,
      id,
    );
  }

  @Post(':id/receive')
  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  @ApiOperation({
    summary:
      'Receive Transfer (IN_TRANSIT -> RECEIVED; verifies destination branch access, records discrepancies, increases stock at transfer cost, recalculates WAC, moves ProductUnits to destination)',
  })
  @ApiParam({ name: 'id', description: 'Transfer UUID' })
  async receiveTransfer(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiveTransferDto,
  ) {
    return this.transferService.receiveTransfer(
      user.businessId,
      branchContext.branchId,
      user.id,
      id,
      dto,
    );
  }

  @Post(':id/reject')
  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  @ApiOperation({
    summary: 'Reject Transfer (If in transit, reverses stock back to source branch at original cost)',
  })
  @ApiParam({ name: 'id', description: 'Transfer UUID' })
  async rejectTransfer(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.transferService.rejectTransfer(
      user.businessId,
      branchContext.branchId,
      user.id,
      id,
    );
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  @ApiOperation({ summary: 'Cancel Transfer (If in transit, returns stock to source)' })
  @ApiParam({ name: 'id', description: 'Transfer UUID' })
  async cancelTransfer(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.transferService.cancelTransfer(
      user.businessId,
      branchContext.branchId,
      user.id,
      id,
    );
  }

  @Post('instant')
  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  @ApiOperation({
    summary:
      'Instant Transfer (Internal/Admin endpoint: dispatches + receives in one go; idempotent via idempotency_key)',
  })
  async instantTransfer(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InstantTransferDto,
  ) {
    return this.transferService.instantTransferEndpoint(
      user.businessId,
      user.id,
      dto,
    );
  }
}
