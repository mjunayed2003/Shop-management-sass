import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { PlatformSupportService } from '../services/platform-support.service.js';
import { TicketPriority } from '../../../generated/prisma/client.js';

@Controller('api/v1/support/tickets')
@UseGuards(JwtAuthGuard)
export class BusinessSupportController {
  constructor(private readonly supportService: PlatformSupportService) {}

  @Post()
  async createTicket(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      subject: string;
      description: string;
      priority?: TicketPriority;
    },
  ) {
    return this.supportService.createBusinessTicket(user.businessId, user.id, body);
  }

  @Get()
  async listTickets(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.supportService.listBusinessTickets(
      user.businessId,
      parseInt(page, 10),
      parseInt(limit, 10),
    );
  }

  @Get(':id')
  async getTicketThread(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.supportService.getBusinessTicketThread(user.businessId, id);
  }

  @Post(':id/messages')
  async replyToTicket(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('message') message: string,
  ) {
    return this.supportService.replyAsBusinessUser(user.businessId, user.id, id, message);
  }

  @Patch(':id/close')
  async closeTicket(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.supportService.closeBusinessTicket(user.businessId, id);
  }
}
