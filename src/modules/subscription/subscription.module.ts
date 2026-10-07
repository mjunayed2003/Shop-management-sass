import { Module } from '@nestjs/common';
import { PlanLimitService } from './services/plan-limit.service.js';
import { SubscriptionService } from './services/subscription.service.js';
import { SubscriptionBillingService } from './services/subscription-billing.service.js';
import { PlatformSequenceService } from './services/platform-sequence.service.js';
import { SubscriptionController } from './controllers/subscription.controller.js';
import { PrismaModule } from '../../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [SubscriptionController],
  providers: [
    PlanLimitService,
    SubscriptionService,
    SubscriptionBillingService,
    PlatformSequenceService,
  ],
  exports: [
    PlanLimitService,
    SubscriptionService,
    SubscriptionBillingService,
    PlatformSequenceService,
  ],
})
export class SubscriptionModule {}
