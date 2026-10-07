import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import { PlatformAuthGuard } from '../guards/platform-auth.guard.js';
import { PlatformRoles } from '../guards/platform-roles.decorator.js';
import { SuperAdminRole } from '../../../generated/prisma/client.js';
import { PlatformAuthService } from '../services/platform-auth.service.js';

@Controller('platform/admins')
@UseGuards(PlatformAuthGuard)
export class PlatformAdminsController {
  constructor(private readonly authService: PlatformAuthService) {}

  @Get()
  @PlatformRoles(SuperAdminRole.SUPER_ADMIN)
  async listAdmins() {
    return this.authService.listAdmins();
  }

  @Post()
  @PlatformRoles(SuperAdminRole.SUPER_ADMIN)
  async createAdmin(
    @Req() req: any,
    @Body()
    body: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      phone?: string;
      role?: SuperAdminRole;
    },
  ) {
    return this.authService.createAdmin(req.superAdmin.role, body);
  }

  @Patch(':id')
  @PlatformRoles(SuperAdminRole.SUPER_ADMIN)
  async updateAdmin(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { role?: SuperAdminRole; isActive?: boolean },
  ) {
    return this.authService.updateAdmin(req.superAdmin.role, id, body);
  }
}
