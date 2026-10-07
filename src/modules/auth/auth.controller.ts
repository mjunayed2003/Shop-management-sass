import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Req,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { OptionalBranch } from '../../common/decorators/optional-branch.decorator.js';

@ApiTags('Auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email or phone + password' })
  @ApiResponse({ status: 200, description: 'Login successful with JWT and user session' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 403, description: 'Subscription suspended or account deactivated' })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.authService.login(dto, ipAddress, userAgent);
  }

  @ApiBearerAuth()
  @OptionalBranch()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and revoke active user session' })
  @ApiResponse({ status: 200, description: 'Session revoked successfully' })
  async logout(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.logout(user);
  }

  @ApiBearerAuth()
  @OptionalBranch()
  @Get('me')
  @ApiOperation({ summary: 'Get current user profile and accessible branches' })
  @ApiResponse({ status: 200, description: 'Current profile data' })
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getProfile(user.id, user.businessId);
  }

  @ApiBearerAuth()
  @OptionalBranch()
  @Get('sessions')
  async getSessions(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getUserSessions(user.id);
  }

  @ApiBearerAuth()
  @OptionalBranch()
  @Delete('sessions/:id')
  async revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) sessionId: string,
  ) {
    return this.authService.revokeSession(user.id, sessionId);
  }

  @ApiBearerAuth()
  @OptionalBranch()
  @Post('logout-all')
  async logoutAll(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.logoutAllDevices(user.id);
  }

  @ApiBearerAuth()
  @OptionalBranch()
  @Post('change-password')
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { oldPassword: string; newPassword: string },
  ) {
    return this.authService.changePassword(user.id, body.oldPassword, body.newPassword);
  }

  @Public()
  @Post('forgot-password')
  async forgotPassword(@Body('identifier') identifier: string) {
    return this.authService.forgotPassword(identifier);
  }

  @Public()
  @Post('reset-password')
  async resetPassword(
    @Body() body: { identifier: string; otp: string; newPassword: string },
  ) {
    return this.authService.resetPassword(body.identifier, body.otp, body.newPassword);
  }
}
