import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { PlatformAuthGuard } from '../guards/platform-auth.guard.js';
import { PlatformRoles } from '../guards/platform-roles.decorator.js';
import { SuperAdminRole } from '../../../generated/prisma/client.js';
import { PlatformSettingsService } from '../services/platform-settings.service.js';

@Controller('platform/settings')
@UseGuards(PlatformAuthGuard)
export class PlatformSettingsController {
  constructor(private readonly settingsService: PlatformSettingsService) {}

  @Get()
  async listSettings() {
    return this.settingsService.listSettings();
  }

  @Get(':key')
  async getSetting(@Param('key') key: string) {
    return this.settingsService.getSetting(key);
  }

  @Post()
  @PlatformRoles(SuperAdminRole.SUPER_ADMIN)
  async setSetting(
    @Body()
    body: {
      key: string;
      value: string;
      description?: string;
      isEncrypted?: boolean;
    },
  ) {
    return this.settingsService.setSetting(body);
  }
}
