import { Module } from '@nestjs/common';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { OnboardingModule } from './modules/onboarding/onboarding.module.js';
import { BranchModule } from './modules/branch/branch.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { SalesModule } from './modules/sales/sales.module.js';
import { ExpenseModule } from './modules/expense/expense.module.js';
import { SubscriptionModule } from './modules/subscription/subscription.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { SmsModule } from './modules/sms/sms.module.js';
import { SyncModule } from './modules/sync/sync.module.js';
import { PlatformModule } from './modules/platform/platform.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { ExportModule } from './modules/export/export.module.js';

import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { BranchContextGuard } from './common/guards/branch-context.guard.js';
import { PermissionsGuard } from './common/guards/permissions.guard.js';
import { AllExceptionsFilter } from './common/filters/http-exception.filter.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    OnboardingModule,
    BranchModule,
    CatalogModule,
    InventoryModule,
    SalesModule,
    ExpenseModule,
    SubscriptionModule,
    NotificationsModule,
    SmsModule,
    SyncModule,
    PlatformModule,
    DashboardModule,
    ExportModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: BranchContextGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
  ],
})
export class AppModule {}
