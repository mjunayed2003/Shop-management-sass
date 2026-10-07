import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { CurrentBranch } from '../../common/decorators/current-branch.decorator.js';
import { ExportService } from './export.service.js';

@Controller('api/v1/exports')
@UseGuards(JwtAuthGuard)
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  private sendCsv(res: Response, filename: string, csvData: string) {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csvData);
  }

  @Get('sales')
  async exportSales(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchId: string | undefined,
    @Res() res: Response,
  ) {
    const csv = await this.exportService.exportSales(user.businessId, branchId, user.isOwner);
    return this.sendCsv(res, `sales-${Date.now()}.csv`, csv);
  }

  @Get('stock')
  async exportStock(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchId: string | undefined,
    @Res() res: Response,
  ) {
    const csv = await this.exportService.exportStock(user.businessId, branchId, user.isOwner);
    return this.sendCsv(res, `stock-${Date.now()}.csv`, csv);
  }

  @Get('expenses')
  async exportExpenses(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchId: string | undefined,
    @Res() res: Response,
  ) {
    const csv = await this.exportService.exportExpenses(user.businessId, branchId, user.isOwner);
    return this.sendCsv(res, `expenses-${Date.now()}.csv`, csv);
  }

  @Get('customer-due')
  async exportCustomerDue(
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const csv = await this.exportService.exportCustomerDue(user.businessId);
    return this.sendCsv(res, `customer-due-${Date.now()}.csv`, csv);
  }

  @Get('sms-logs')
  async exportSmsLogs(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchId: string | undefined,
    @Res() res: Response,
  ) {
    const csv = await this.exportService.exportSmsLogs(user.businessId, branchId, user.isOwner);
    return this.sendCsv(res, `sms-logs-${Date.now()}.csv`, csv);
  }

  @Get('audit-logs')
  async exportAuditLogs(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchId: string | undefined,
    @Res() res: Response,
  ) {
    const csv = await this.exportService.exportAuditLogs(user.businessId, branchId, user.isOwner);
    return this.sendCsv(res, `audit-logs-${Date.now()}.csv`, csv);
  }
}
