import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import { PlatformAuthGuard } from '../guards/platform-auth.guard.js';
import { PlatformRoles } from '../guards/platform-roles.decorator.js';
import { SuperAdminRole, BusinessStatus, SubscriptionStatus } from '../../../generated/prisma/client.js';
import { PlatformBusinessesService, CreateOverrideDto } from '../services/platform-businesses.service.js';

@Controller('platform')
@UseGuards(PlatformAuthGuard)
export class PlatformBusinessesController {
  constructor(private readonly businessesService: PlatformBusinessesService) {}

  @Get('businesses')
  async listBusinesses(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('search') search?: string,
    @Query('status') status?: BusinessStatus,
    @Query('subscriptionStatus') subscriptionStatus?: SubscriptionStatus,
  ) {
    return this.businessesService.listBusinesses({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      search,
      status,
      subscriptionStatus,
    });
  }

  @Get('businesses/:id')
  async getBusinessDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.businessesService.getBusinessDetail(id);
  }

  @Post('businesses/:id/suspend')
  @PlatformRoles(SuperAdminRole.SUPER_ADMIN, SuperAdminRole.PLATFORM_SUPPORT)
  async suspendBusiness(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string,
  ) {
    return this.businessesService.suspendBusiness(req.superAdmin.id, id, reason);
  }

  @Post('businesses/:id/reactivate')
  @PlatformRoles(SuperAdminRole.SUPER_ADMIN, SuperAdminRole.PLATFORM_SUPPORT)
  async reactivateBusiness(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string,
  ) {
    return this.businessesService.reactivateBusiness(req.superAdmin.id, id, reason);
  }

  @Post('overrides')
  @PlatformRoles(SuperAdminRole.SUPER_ADMIN, SuperAdminRole.BILLING_ADMIN)
  async createOverride(@Req() req: any, @Body() dto: CreateOverrideDto) {
    return this.businessesService.createSubscriptionOverride(req.superAdmin.id, dto);
  }

  @Patch('overrides/:id/expire')
  @PlatformRoles(SuperAdminRole.SUPER_ADMIN, SuperAdminRole.BILLING_ADMIN)
  async expireOverride(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.businessesService.expireSubscriptionOverride(req.superAdmin.id, id);
  }
}
