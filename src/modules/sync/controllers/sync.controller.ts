import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { BranchContextGuard } from '../../../common/guards/branch-context.guard.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { CurrentBranch } from '../../../common/decorators/current-branch.decorator.js';
import { SyncService, SyncPushItem } from '../services/sync.service.js';

@Controller('api/v1/sync')
@UseGuards(JwtAuthGuard, BranchContextGuard)
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('reserve-invoice-numbers')
  async reserveInvoiceNumbers(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchId: string,
    @Body('count') count?: number,
  ) {
    return this.syncService.reserveInvoiceNumbers(user.businessId, branchId, count);
  }

  @Get('bootstrap')
  async getBootstrapData(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchId: string,
    @Query('updated_since') updatedSince?: string,
  ) {
    return this.syncService.getBootstrapData(
      user.businessId,
      branchId,
      user.id,
      updatedSince,
    );
  }

  @Post('push')
  async pushBatch(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchId: string,
    @Body('items') items: SyncPushItem[],
  ) {
    return this.syncService.pushBatch(user.businessId, branchId, user.id, items);
  }

  @Get('conflicts')
  async getConflicts(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchId: string,
  ) {
    return this.syncService.getConflicts(user.businessId, branchId, user.isOwner);
  }

  @Post('conflicts/:id/retry')
  async retryItem(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.syncService.retryItem(user.businessId, branchId, user.id, id);
  }

  @Post('conflicts/:id/resolve')
  async resolveConflict(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('notes') notes: string,
  ) {
    return this.syncService.resolveConflict(user.businessId, id, notes);
  }

  @Get('negative-stock')
  async getNegativeStock(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchId: string,
  ) {
    return this.syncService.getNegativeStockToResolve(user.businessId, branchId);
  }

  @Get('status')
  async getSyncStatus(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchId: string,
  ) {
    return this.syncService.getSyncStatus(user.businessId, branchId);
  }
}
