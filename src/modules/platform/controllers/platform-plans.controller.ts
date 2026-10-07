import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { PlatformAuthGuard } from '../guards/platform-auth.guard.js';
import { PlatformRoles } from '../guards/platform-roles.decorator.js';
import { SuperAdminRole } from '../../../generated/prisma/client.js';
import { PlatformPlansService, CreatePlanDto } from '../services/platform-plans.service.js';

@Controller('platform/plans')
@UseGuards(PlatformAuthGuard)
export class PlatformPlansController {
  constructor(private readonly plansService: PlatformPlansService) {}

  @Get()
  async listPlans() {
    return this.plansService.listPlans();
  }

  @Post()
  @PlatformRoles(SuperAdminRole.SUPER_ADMIN, SuperAdminRole.BILLING_ADMIN)
  async createPlan(@Body() dto: CreatePlanDto) {
    return this.plansService.createPlan(dto);
  }

  @Patch(':id')
  @PlatformRoles(SuperAdminRole.SUPER_ADMIN, SuperAdminRole.BILLING_ADMIN)
  async updatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Partial<CreatePlanDto> & { isActive?: boolean },
  ) {
    return this.plansService.updatePlan(id, dto);
  }

  @Delete(':id')
  @PlatformRoles(SuperAdminRole.SUPER_ADMIN)
  async deletePlan(@Param('id', ParseUUIDPipe) id: string) {
    return this.plansService.deletePlan(id);
  }
}
