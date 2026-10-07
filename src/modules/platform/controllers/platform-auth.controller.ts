import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { PlatformAuthService } from '../services/platform-auth.service.js';
import { PlatformAuthGuard } from '../guards/platform-auth.guard.js';
import { Public } from '../../../common/decorators/public.decorator.js';

@Controller('platform/auth')
export class PlatformAuthController {
  constructor(private readonly authService: PlatformAuthService) {}

  @Public()
  @Post('login')
  async login(@Body() body: { email: string; pass: string; password?: string }) {
    const password = body.password || body.pass;
    return this.authService.login(body.email, password);
  }

  @UseGuards(PlatformAuthGuard)
  @Post('logout')
  async logout() {
    return { success: true, message: 'Platform admin logged out.' };
  }

  @UseGuards(PlatformAuthGuard)
  @Post('change-password')
  async changePassword(
    @Req() req: any,
    @Body() body: { oldPassword: string; newPassword: string },
  ) {
    return this.authService.changePassword(
      req.superAdmin.id,
      body.oldPassword,
      body.newPassword,
    );
  }

  @UseGuards(PlatformAuthGuard)
  @Get('me')
  async getMe(@Req() req: any) {
    return req.superAdmin;
  }
}
