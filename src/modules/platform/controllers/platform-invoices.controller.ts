import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Headers,
  UseGuards,
  UnauthorizedException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { PlatformAuthGuard } from '../guards/platform-auth.guard.js';
import { PlatformRoles } from '../guards/platform-roles.decorator.js';
import {
  SuperAdminRole,
  PlatformInvoiceStatus,
  PlatformPaymentMethod,
} from '../../../generated/prisma/client.js';
import { PlatformInvoicesService } from '../services/platform-invoices.service.js';
import { Public } from '../../../common/decorators/public.decorator.js';
import { createHmac } from 'node:crypto';

@Controller('platform')
export class PlatformInvoicesController {
  constructor(private readonly invoicesService: PlatformInvoicesService) {}

  @UseGuards(PlatformAuthGuard)
  @Get('invoices')
  async listInvoices(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('status') status?: PlatformInvoiceStatus,
    @Query('businessId') businessId?: string,
  ) {
    return this.invoicesService.listInvoices({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      status,
      businessId,
    });
  }

  @UseGuards(PlatformAuthGuard)
  @Post('invoices/:id/void')
  @PlatformRoles(SuperAdminRole.SUPER_ADMIN, SuperAdminRole.BILLING_ADMIN)
  async voidInvoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoicesService.voidInvoice(id);
  }

  @UseGuards(PlatformAuthGuard)
  @Post('invoices/:id/mark-overdue')
  @PlatformRoles(SuperAdminRole.SUPER_ADMIN, SuperAdminRole.BILLING_ADMIN)
  async markOverdue(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoicesService.markOverdue(id);
  }

  @UseGuards(PlatformAuthGuard)
  @Post('invoices/:id/pay')
  @PlatformRoles(SuperAdminRole.SUPER_ADMIN, SuperAdminRole.BILLING_ADMIN)
  async recordPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      amount: number;
      paymentMethod: PlatformPaymentMethod;
      transactionId?: string;
    },
  ) {
    return this.invoicesService.recordPayment(
      id,
      body.amount,
      body.paymentMethod,
      body.transactionId,
    );
  }

  @UseGuards(PlatformAuthGuard)
  @Get('revenue/summary')
  @PlatformRoles(SuperAdminRole.SUPER_ADMIN, SuperAdminRole.BILLING_ADMIN)
  async getRevenueSummary() {
    return this.invoicesService.getRevenueSummary();
  }

  /**
   * Payment Gateway webhook skeleton with HMAC verification and idempotency.
   */
  @Public()
  @Post('payments/webhook')
  async handleGatewayWebhook(
    @Headers('x-webhook-signature') signature: string,
    @Body()
    body: {
      invoice_id: string;
      amount: number;
      payment_method: PlatformPaymentMethod;
      provider_ref: string;
      transaction_id?: string;
    },
  ) {
    const secret = process.env.GATEWAY_WEBHOOK_SECRET || 'platform-gateway-webhook-secret';
    if (!signature) {
      throw new UnauthorizedException('Missing gateway webhook signature');
    }

    const computed = createHmac('sha256', secret)
      .update(JSON.stringify(body))
      .digest('hex');

    if (computed !== signature) {
      throw new UnauthorizedException('Invalid gateway webhook signature');
    }

    return this.invoicesService.recordPayment(
      body.invoice_id,
      body.amount,
      body.payment_method,
      body.transaction_id,
    );
  }
}
