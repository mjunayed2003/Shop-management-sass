import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { ReportService } from '../services/report.service.js';
import {
  ProfitReportQueryDto,
  CollectionsSummaryQueryDto,
} from '../dto/report.dto.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { CurrentBranch } from '../../../common/decorators/current-branch.decorator.js';
import type { BranchContext } from '../../../common/decorators/current-branch.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';

@ApiTags('Reports & Profit Analysis')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-branch-id',
  required: true,
  description: 'Branch context UUID',
})
@Controller('api/v1/sales/reports')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Get('profit')
  @RequirePermissions('report.view')
  @ApiOperation({
    summary: 'Branch and combined Profit & Loss report: gross sales, returns, COGS, gross/net profit',
  })
  async getProfitReport(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Query() query: ProfitReportQueryDto,
  ) {
    return this.reportService.getProfitReport(
      user.businessId,
      branchContext.branchId,
      branchContext.isAllBranchAdmin,
      query,
    );
  }

  @Get('collections')
  @RequirePermissions('report.view')
  @ApiOperation({
    summary: 'Collections summary: cash, bkash, nagad, bank, etc. from sales + dues minus refunds',
  })
  async getCollectionsSummary(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Query() query: CollectionsSummaryQueryDto,
  ) {
    return this.reportService.getCollectionsSummary(
      user.businessId,
      branchContext.branchId,
      branchContext.isAllBranchAdmin,
      query,
    );
  }
}
