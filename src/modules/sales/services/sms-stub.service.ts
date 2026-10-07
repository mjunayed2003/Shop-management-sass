import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';

export interface ISmsProvider {
  sendSms(
    tx: Prisma.TransactionClient,
    params: {
      businessId: string;
      branchId?: string;
      recipientPhone: string;
      message: string;
      purpose?: 'SALE_INVOICE' | 'DUE_REMINDER' | 'OTP' | 'PROMOTIONAL';
    },
  ): Promise<void>;
}

@Injectable()
export class SmsStubService implements ISmsProvider {
  /**
   * Queues an SMS log in the database with status PENDING.
   * Does not dispatch to a real SMS gateway (stub implementation).
   */
  async sendSms(
    tx: Prisma.TransactionClient,
    params: {
      businessId: string;
      branchId?: string;
      recipientPhone: string;
      message: string;
      purpose?: 'SALE_INVOICE' | 'DUE_REMINDER' | 'OTP' | 'PROMOTIONAL';
    },
  ): Promise<void> {
    if (!params.recipientPhone) return;

    await tx.smsLog.create({
      data: {
        business_id: params.businessId,
        branch_id: params.branchId || null,
        recipient_phone: params.recipientPhone,
        message_body: params.message,
        status: 'PENDING',
        purpose: params.purpose || 'SALE_INVOICE',
        cost: new Prisma.Decimal(0.35), // Typical BDT SMS cost
      },
    });
  }
}
