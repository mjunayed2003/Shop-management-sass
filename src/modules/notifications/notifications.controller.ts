import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  Sse,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { NotificationService } from './notifications.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

@Controller('api/v1/notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly prisma: PrismaService,
  ) {}

  private async getUserBranchIds(user: AuthenticatedUser): Promise<string[]> {
    if (user.isOwner) return [];
    const accesses = await this.prisma.userBranchAccess.findMany({
      where: { user_id: user.id },
      select: { branch_id: true },
    });
    return accesses.map((a) => a.branch_id);
  }

  @Get()
  async listNotifications(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('unreadOnly') unreadOnly = 'false',
  ) {
    const branchIds = await this.getUserBranchIds(user);
    return this.notificationService.listNotifications(
      user.businessId,
      user.id,
      branchIds,
      user.isOwner,
      {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        unreadOnly: unreadOnly === 'true',
      },
    );
  }

  @Get('unread-count')
  async getUnreadCount(@CurrentUser() user: AuthenticatedUser) {
    const branchIds = await this.getUserBranchIds(user);
    return this.notificationService.getUnreadCount(
      user.businessId,
      user.id,
      branchIds,
      user.isOwner,
    );
  }

  @Patch(':id/read')
  async markAsRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notificationService.markAsRead(user.businessId, user.id, id);
  }

  @Post('mark-all-read')
  async markAllAsRead(@CurrentUser() user: AuthenticatedUser) {
    const branchIds = await this.getUserBranchIds(user);
    return this.notificationService.markAllAsRead(
      user.businessId,
      user.id,
      branchIds,
      user.isOwner,
    );
  }

  @Sse('stream')
  streamNotifications(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationService.getEventStream(
      user.businessId,
      user.id,
      [], // Owners or filtered by user.id/business
      user.isOwner,
    );
  }
}
