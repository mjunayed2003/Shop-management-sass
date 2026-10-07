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
import { TicketStatus, TicketPriority } from '../../../generated/prisma/client.js';
import { PlatformSupportService } from '../services/platform-support.service.js';

@Controller('platform/tickets')
@UseGuards(PlatformAuthGuard)
export class PlatformSupportController {
  constructor(private readonly supportService: PlatformSupportService) {}

  @Get()
  async listTickets(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('status') status?: TicketStatus,
    @Query('priority') priority?: TicketPriority,
    @Query('businessId') businessId?: string,
  ) {
    return this.supportService.listPlatformTickets({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      status,
      priority,
      businessId,
    });
  }

  @Get(':id')
  async getTicketThread(@Param('id', ParseUUIDPipe) id: string) {
    return this.supportService.getPlatformTicketThread(id);
  }

  @Patch(':id/assign')
  async assignAdmin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('adminId', ParseUUIDPipe) adminId: string,
  ) {
    return this.supportService.assignAdmin(id, adminId);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('status') status: TicketStatus,
  ) {
    return this.supportService.updateStatus(id, status);
  }

  @Post(':id/messages')
  async replyAsAdmin(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('message') message: string,
  ) {
    return this.supportService.replyAsPlatformAdmin(id, req.superAdmin.id, message);
  }
}
