import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  TicketPriority,
  TicketStatus,
  TicketSenderType,
  NotificationType,
} from '../../../generated/prisma/client.js';
import { PlatformSequenceService } from '../../subscription/services/platform-sequence.service.js';
import { NotificationService } from '../../notifications/notifications.service.js';

@Injectable()
export class PlatformSupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequenceService: PlatformSequenceService,
    private readonly notificationService: NotificationService,
  ) {}

  // ==========================================================================
  // BUSINESS FACING
  // ==========================================================================

  async createBusinessTicket(
    businessId: string,
    userId: string,
    dto: { subject: string; description: string; priority?: TicketPriority },
  ) {
    if (!dto.subject || !dto.description) {
      throw new BadRequestException('Subject and description are required.');
    }

    return this.prisma.$transaction(async (tx) => {
      const ticketNo = await this.sequenceService.getNextTicketNumber(tx);

      const ticket = await tx.supportTicket.create({
        data: {
          ticket_no: ticketNo,
          business_id: businessId,
          user_id: userId,
          subject: dto.subject,
          description: dto.description,
          priority: dto.priority || TicketPriority.MEDIUM,
          status: TicketStatus.OPEN,
        },
      });

      // Add initial thread message
      await tx.supportTicketMessage.create({
        data: {
          ticket_id: ticket.id,
          sender_type: TicketSenderType.BUSINESS_USER,
          sender_user_id: userId,
          message: dto.description,
        },
      });

      return ticket;
    });
  }

  async listBusinessTickets(businessId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where: { business_id: businessId },
        include: {
          assigned_admin: { select: { first_name: true, last_name: true } },
          _count: { select: { messages: true } },
        },
        orderBy: { updated_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.supportTicket.count({ where: { business_id: businessId } }),
    ]);

    return {
      data: tickets,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getBusinessTicketThread(businessId: string, ticketId: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, business_id: businessId },
      include: {
        assigned_admin: { select: { id: true, first_name: true, last_name: true } },
        messages: {
          orderBy: { created_at: 'asc' },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Support ticket not found.');
    }

    return ticket;
  }

  async replyAsBusinessUser(
    businessId: string,
    userId: string,
    ticketId: string,
    message: string,
  ) {
    if (!message || !message.trim()) {
      throw new BadRequestException('Message cannot be empty.');
    }

    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, business_id: businessId },
    });
    if (!ticket) {
      throw new NotFoundException('Support ticket not found.');
    }

    return this.prisma.$transaction(async (tx) => {
      const msg = await tx.supportTicketMessage.create({
        data: {
          ticket_id: ticketId,
          sender_type: TicketSenderType.BUSINESS_USER,
          sender_user_id: userId,
          message: message.trim(),
        },
      });

      await tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          status: ticket.status === TicketStatus.CLOSED ? TicketStatus.IN_PROGRESS : ticket.status,
          updated_at: new Date(),
        },
      });

      return msg;
    });
  }

  async closeBusinessTicket(businessId: string, ticketId: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, business_id: businessId },
    });
    if (!ticket) {
      throw new NotFoundException('Support ticket not found.');
    }

    return this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: TicketStatus.CLOSED },
    });
  }

  // ==========================================================================
  // PLATFORM / ADMIN FACING
  // ==========================================================================

  async listPlatformTickets(query: {
    page?: number;
    limit?: number;
    status?: TicketStatus;
    priority?: TicketPriority;
    businessId?: string;
  }) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.businessId) where.business_id = query.businessId;

    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        include: {
          business: { select: { id: true, name: true, slug: true } },
          assigned_admin: { select: { id: true, first_name: true, last_name: true } },
          _count: { select: { messages: true } },
        },
        orderBy: { updated_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return {
      data: tickets,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getPlatformTicketThread(ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        business: true,
        user: { select: { id: true, first_name: true, last_name: true, email: true, phone: true } },
        assigned_admin: { select: { id: true, first_name: true, last_name: true } },
        messages: {
          orderBy: { created_at: 'asc' },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found.');
    }

    return ticket;
  }

  async assignAdmin(ticketId: string, adminId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found.');

    return this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        assigned_admin_id: adminId,
        status: ticket.status === TicketStatus.OPEN ? TicketStatus.IN_PROGRESS : ticket.status,
      },
    });
  }

  async updateStatus(ticketId: string, status: TicketStatus) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found.');

    return this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status },
    });
  }

  async replyAsPlatformAdmin(ticketId: string, adminId: string, message: string) {
    if (!message || !message.trim()) {
      throw new BadRequestException('Message cannot be empty.');
    }

    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) throw new NotFoundException('Ticket not found.');

    const msg = await this.prisma.$transaction(async (tx) => {
      const createdMsg = await tx.supportTicketMessage.create({
        data: {
          ticket_id: ticketId,
          sender_type: TicketSenderType.PLATFORM_ADMIN,
          sender_admin_id: adminId,
          message: message.trim(),
        },
      });

      await tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          status: TicketStatus.IN_PROGRESS,
          updated_at: new Date(),
        },
      });

      return createdMsg;
    });

    // Notify the business user
    await this.notificationService.create({
      businessId: ticket.business_id,
      userId: ticket.user_id || undefined,
      type: NotificationType.SYSTEM_ALERT,
      title: `Reply on Support Ticket #${ticket.ticket_no}`,
      message: `A support agent has replied to your ticket "${ticket.subject}".`,
    });

    return msg;
  }
}
