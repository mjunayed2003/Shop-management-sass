import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { SubscriptionModule } from '../subscription/subscription.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

import { PlatformAuthGuard } from './guards/platform-auth.guard.js';
import { PlatformAuthService } from './services/platform-auth.service.js';
import { PlatformPlansService } from './services/platform-plans.service.js';
import { PlatformBusinessesService } from './services/platform-businesses.service.js';
import { PlatformInvoicesService } from './services/platform-invoices.service.js';
import { PlatformSupportService } from './services/platform-support.service.js';
import { PlatformSettingsService } from './services/platform-settings.service.js';
import { PlatformDashboardService } from './services/platform-dashboard.service.js';

import { PlatformAuthController } from './controllers/platform-auth.controller.js';
import { PlatformAdminsController } from './controllers/platform-admins.controller.js';
import { PlatformPlansController } from './controllers/platform-plans.controller.js';
import { PlatformBusinessesController } from './controllers/platform-businesses.controller.js';
import { PlatformInvoicesController } from './controllers/platform-invoices.controller.js';
import { PlatformSupportController } from './controllers/platform-support.controller.js';
import { BusinessSupportController } from './controllers/business-support.controller.js';
import { PlatformSettingsController } from './controllers/platform-settings.controller.js';
import { PlatformDashboardController } from './controllers/platform-dashboard.controller.js';

@Module({
  imports: [
    PrismaModule,
    SubscriptionModule,
    NotificationsModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'super-secret-shop-jwt-key-2026',
    }),
  ],
  controllers: [
    PlatformAuthController,
    PlatformAdminsController,
    PlatformPlansController,
    PlatformBusinessesController,
    PlatformInvoicesController,
    PlatformSupportController,
    BusinessSupportController,
    PlatformSettingsController,
    PlatformDashboardController,
  ],
  providers: [
    PlatformAuthGuard,
    PlatformAuthService,
    PlatformPlansService,
    PlatformBusinessesService,
    PlatformInvoicesService,
    PlatformSupportService,
    PlatformSettingsService,
    PlatformDashboardService,
  ],
  exports: [
    PlatformAuthService,
    PlatformSettingsService,
    PlatformSupportService,
    PlatformPlansService,
    PlatformInvoicesService,
  ],
})
export class PlatformModule {}
