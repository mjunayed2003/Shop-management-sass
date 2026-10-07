import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { SubscriptionService } from '../services/subscription.service.js';
import { UpgradeSubscriptionDto, CancelSubscriptionDto } from '../dto/upgrade-subscription.dto.js';

@Controller('api/v1/subscription')
@UseGuards(JwtAuthGuard)
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Get('current')
  async getCurrentSubscription(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptionService.getCurrentSubscription(user.businessId);
  }

  @Get('invoices')
  async getInvoices(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.subscriptionService.getInvoices(
      user.businessId,
      parseInt(page, 10),
      parseInt(limit, 10),
    );
  }

  @Get('invoices/:id')
  async getInvoiceDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.subscriptionService.getInvoiceDetail(user.businessId, id);
  }

  @Get('payments')
  async getPaymentHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.subscriptionService.getPaymentHistory(
      user.businessId,
      parseInt(page, 10),
      parseInt(limit, 10),
    );
  }

  @Post('upgrade')
  async upgradePlan(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpgradeSubscriptionDto,
  ) {
    return this.subscriptionService.upgradePlan(user.businessId, dto.planId, dto.billingCycle);
  }

  @Post('cancel')
  async cancelSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CancelSubscriptionDto,
  ) {
    return this.subscriptionService.cancelSubscription(user.businessId, dto.reason);
  }
}
