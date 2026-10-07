import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { CurrentBranch } from '../../common/decorators/current-branch.decorator.js';
import { DashboardService } from './dashboard.service.js';
import { AuditAction } from '../../generated/prisma/client.js';

@Controller('api/v1/audit-logs')
@UseGuards(JwtAuthGuard)
export class AuditLogController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  async getAuditLogs(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchId: string | undefined,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
    @Query('userId') userId?: string,
    @Query('action') action?: AuditAction,
    @Query('entityTable') entityTable?: string,
  ) {
    return this.dashboardService.getAuditLogs(
      user.businessId,
      branchId,
      user.isOwner,
      {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        userId,
        action,
        entityTable,
      },
    );
  }
}
