import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { CurrentBranch } from '../../common/decorators/current-branch.decorator.js';
import { DashboardService } from './dashboard.service.js';

@Controller('api/v1/dashboards')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('business')
  async getBusinessDashboard(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchId: string | undefined,
    @Req() req: any,
  ) {
    const isAllBranchAdmin = user.isOwner || req.branchContext?.isAllBranchAdmin;
    const permissions = user.isOwner ? ['*'] : req.userPermissions || [];
    const canViewProfit =
      user.isOwner ||
      permissions.includes('*') ||
      permissions.includes('report.view_profit') ||
      permissions.includes('report.view');

    return this.dashboardService.getBusinessDashboard(
      user.businessId,
      branchId,
      Boolean(isAllBranchAdmin),
      Boolean(canViewProfit),
    );
  }

  @Get('cashier')
  async getCashierDashboard(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchId: string,
  ) {
    return this.dashboardService.getCashierDashboard(
      user.businessId,
      branchId,
      user.id,
    );
  }
}
