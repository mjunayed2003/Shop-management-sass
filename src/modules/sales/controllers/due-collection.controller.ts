import {
  Controller,
  Get,
  Post,
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
import { DueCollectionService } from '../services/due-collection.service.js';
import {
  CreateDueCollectionDto,
  DueCollectionQueryDto,
} from '../dto/due-collection.dto.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { CurrentBranch } from '../../../common/decorators/current-branch.decorator.js';
import type { BranchContext } from '../../../common/decorators/current-branch.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';

@ApiTags('Due Collection')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-branch-id',
  required: true,
  description: 'Branch context UUID',
})
@Controller('api/v1/sales/due-collections')
export class DueCollectionController {
  constructor(private readonly dueCollectionService: DueCollectionService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('due.collect')
  @ApiOperation({
    summary: 'Collect customer credit dues in ONE atomic transaction with oldest-first allocation',
  })
  @ApiResponse({ status: 201, description: 'Due collection created successfully' })
  async collectDue(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Body() dto: CreateDueCollectionDto,
  ) {
    return this.dueCollectionService.collectDue(
      user.businessId,
      branchContext.branchId,
      user.id,
      dto,
    );
  }

  @Get('reports/outstanding')
  @RequirePermissions('report.view')
  @ApiOperation({
    summary: 'Outstanding customer dues report with aging buckets (0-30, 31-60, 61-90, 90+ days)',
  })
  async getOutstandingDueReport(@CurrentUser() user: AuthenticatedUser) {
    return this.dueCollectionService.getOutstandingDueReport(user.businessId);
  }

  @Get('reports/branch-split')
  @RequirePermissions('report.view')
  @ApiOperation({ summary: 'Per-branch outstanding customer due split' })
  async getBranchDueSplitReport(@CurrentUser() user: AuthenticatedUser) {
    return this.dueCollectionService.getBranchDueSplitReport(user.businessId);
  }

  @Get()
  @RequirePermissions('due.collect')
  @ApiOperation({ summary: 'List due collections for branch with pagination' })
  async getDueCollectionList(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Query() query: DueCollectionQueryDto,
  ) {
    return this.dueCollectionService.getDueCollectionList(
      user.businessId,
      branchContext.branchId,
      query,
      branchContext.isAllBranchAdmin,
    );
  }

  @Get(':id')
  @RequirePermissions('due.collect')
  @ApiOperation({ summary: 'Get due collection detail by ID' })
  @ApiParam({ name: 'id', description: 'DueCollection UUID' })
  async getDueCollectionDetail(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id') collectionId: string,
  ) {
    return this.dueCollectionService.getDueCollectionDetail(
      user.businessId,
      branchContext.branchId,
      collectionId,
      branchContext.isAllBranchAdmin,
    );
  }

  @Get(':id/receipt')
  @RequirePermissions('due.collect')
  @ApiOperation({ summary: 'Get printable due collection money receipt data' })
  @ApiParam({ name: 'id', description: 'DueCollection UUID' })
  async getDueReceipt(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id') collectionId: string,
  ) {
    return this.dueCollectionService.getDueReceipt(
      user.businessId,
      branchContext.branchId,
      collectionId,
      branchContext.isAllBranchAdmin,
    );
  }
}
