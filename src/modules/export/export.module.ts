import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { ExportService } from './export.service.js';
import { ExportController } from './export.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [ExportController],
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
