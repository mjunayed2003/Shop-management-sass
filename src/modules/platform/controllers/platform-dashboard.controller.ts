import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PlatformAuthGuard } from '../guards/platform-auth.guard.js';
import { PlatformDashboardService } from '../services/platform-dashboard.service.js';

@Controller('platform')
@UseGuards(PlatformAuthGuard)
export class PlatformDashboardController {
  constructor(private readonly dashboardService: PlatformDashboardService) {}

  @Get('dashboard')
  async getDashboardMetrics() {
    return this.dashboardService.getPlatformMetrics();
  }

  @Get('audit-logs')
  async getGlobalAuditLogs(
    @Query('page') page = '1',
    @Query('limit') limit = '50',
    @Query('businessId') businessId?: string,
    @Query('action') action?: string,
    @Query('entityTable') entityTable?: string,
  ) {
    return this.dashboardService.getGlobalAuditLogs({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      businessId,
      action,
      entityTable,
    });
  }
}
