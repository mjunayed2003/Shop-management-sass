import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Headers,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { CurrentBranch } from '../../../common/decorators/current-branch.decorator.js';
import { SmsService } from '../services/sms.service.js';
import { SmsPurpose, SmsStatus } from '../../../generated/prisma/client.js';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { Public } from '../../../common/decorators/public.decorator.js';

@Controller('api/v1/sms')
export class SmsController {
  constructor(
    private readonly smsService: SmsService,
    private readonly prisma: PrismaService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('logs')
  async listLogs(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchId: string | undefined,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('purpose') purpose?: SmsPurpose,
    @Query('status') status?: SmsStatus,
  ) {
    return this.smsService.listLogs(user.businessId, branchId, user.isOwner, {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      purpose,
      status,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('due-reminder/preview')
  async previewDueReminders(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { minDue?: number; olderThanDays?: number; customerId?: string },
  ) {
    return this.smsService.previewDueReminders(
      user.businessId,
      body.minDue ?? 100,
      body.olderThanDays ?? 0,
      body.customerId,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('due-reminder')
  async sendDueReminders(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchId: string,
    @Body()
    body: {
      minDue?: number;
      olderThanDays?: number;
      customerId?: string;
      lang?: 'en' | 'bn';
    },
  ) {
    return this.smsService.sendDueReminders(
      user.businessId,
      branchId,
      body.minDue ?? 100,
      body.olderThanDays ?? 0,
      body.customerId,
      body.lang || 'bn',
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('promotional')
  async sendPromotionalCampaign(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchId: string,
    @Body()
    body: {
      message: string;
      boughtInLastDays?: number;
      minSpend?: number;
      lang?: 'en' | 'bn';
    },
  ) {
    return this.smsService.sendPromotionalCampaign(
      user.businessId,
      branchId,
      body.message,
      body.boughtInLastDays ?? 30,
      body.minSpend ?? 0,
      body.lang || 'en',
    );
  }

  /**
   * Delivery status webhook endpoint with HMAC signature verification.
   */
  @Public()
  @Post('webhook')
  async handleWebhook(
    @Headers('x-webhook-signature') signature: string,
    @Body() body: { provider_ref: string; status: string },
  ) {
    const secret = process.env.SMS_WEBHOOK_SECRET || 'default-sms-webhook-secret';
    if (!signature) {
      throw new UnauthorizedException('Missing webhook signature');
    }

    const computed = createHmac('sha256', secret)
      .update(JSON.stringify(body))
      .digest('hex');

    if (computed !== signature) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    if (body.provider_ref && body.status === 'DELIVERED') {
      await this.prisma.smsLog.updateMany({
        where: { provider_ref: body.provider_ref },
        data: { status: SmsStatus.DELIVERED },
      });
    }

    return { received: true };
  }
}
