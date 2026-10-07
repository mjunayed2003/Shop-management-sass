import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { DashboardService } from './dashboard.service.js';
import { DashboardController } from './dashboard.controller.js';
import { AuditLogController } from './audit-log.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [DashboardController, AuditLogController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
