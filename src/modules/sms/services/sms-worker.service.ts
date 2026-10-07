import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { SMS_PROVIDER_TOKEN, SmsProvider } from '../interfaces/sms-provider.interface.js';
import { SmsStatus } from '../../../generated/prisma/client.js';

@Injectable()
export class SmsWorkerService {
  private readonly logger = new Logger(SmsWorkerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SMS_PROVIDER_TOKEN) private readonly smsProvider: SmsProvider,
  ) {}

  /**
   * Atomically claims PENDING messages using FOR UPDATE SKIP LOCKED to guarantee
   * zero double-sending across concurrent worker executions.
   */
  async processPendingMessages(batchSize = 25): Promise<{ processed: number; sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    // Run claim and processing in transaction with SKIP LOCKED
    const processedIds = await this.prisma.$transaction(async (tx) => {
      // 1. Claim rows atomically
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM sms_logs
        WHERE status = 'PENDING'
        ORDER BY created_at ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `;

      if (rows.length === 0) return [];

      const ids = rows.map((r) => r.id);

      // 2. Fetch full records
      const logs = await tx.smsLog.findMany({
        where: { id: { in: ids } },
      });

      for (const log of logs) {
        try {
          const result = await this.smsProvider.sendSms(
            log.recipient_phone,
            log.message_body,
            log.sender_id || undefined,
          );

          if (result.success) {
            await tx.smsLog.update({
              where: { id: log.id },
              data: {
                status: SmsStatus.SENT,
                provider_ref: result.providerRef || null,
                cost: result.cost !== undefined ? result.cost : log.cost,
              },
            });
            sent++;
          } else {
            await tx.smsLog.update({
              where: { id: log.id },
              data: {
                status: SmsStatus.FAILED,
                provider_ref: result.errorMessage || 'Provider failed',
              },
            });
            failed++;
          }
        } catch (err: any) {
          await tx.smsLog.update({
            where: { id: log.id },
            data: {
              status: SmsStatus.FAILED,
              provider_ref: err.message || 'Worker exception',
            },
          });
          failed++;
        }
      }

      return ids;
    });

    return { processed: processedIds.length, sent, failed };
  }
}
