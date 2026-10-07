import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { SubscriptionModule } from '../subscription/subscription.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { BranchModule } from '../branch/branch.module.js';
import { SyncService } from './services/sync.service.js';
import { SyncController } from './controllers/sync.controller.js';

@Module({
  imports: [
    PrismaModule,
    SalesModule,
    SubscriptionModule,
    NotificationsModule,
    BranchModule,
  ],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
