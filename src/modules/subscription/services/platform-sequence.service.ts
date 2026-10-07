import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { Prisma } from '../../../generated/prisma/client.js';

@Injectable()
export class PlatformSequenceService {
  constructor(private readonly prisma: PrismaService) {}

  async getNextInvoiceNumber(tx?: Prisma.TransactionClient): Promise<string> {
    const client = tx || this.prisma;
    const key = 'seq:platform_invoice';

    await client.systemSetting.upsert({
      where: { key },
      update: {},
      create: { key, value: '1000', description: 'Platform Subscription Invoice Sequence' },
    });

    const locked = await client.$queryRaw<Array<{ value: string }>>`
      SELECT value FROM system_settings WHERE key = ${key} FOR UPDATE
    `;

    const nextVal = parseInt(locked[0]?.value || '1000', 10) + 1;
    await client.systemSetting.update({
      where: { key },
      data: { value: nextVal.toString() },
    });

    return `PINV-${String(nextVal).padStart(6, '0')}`;
  }

  async getNextTicketNumber(tx?: Prisma.TransactionClient): Promise<string> {
    const client = tx || this.prisma;
    const key = 'seq:support_ticket';

    await client.systemSetting.upsert({
      where: { key },
      update: {},
      create: { key, value: '1000', description: 'Support Ticket Sequence' },
    });

    const locked = await client.$queryRaw<Array<{ value: string }>>`
      SELECT value FROM system_settings WHERE key = ${key} FOR UPDATE
    `;

    const nextVal = parseInt(locked[0]?.value || '1000', 10) + 1;
    await client.systemSetting.update({
      where: { key },
      data: { value: nextVal.toString() },
    });

    return `TICK-${String(nextVal).padStart(6, '0')}`;
  }
}
