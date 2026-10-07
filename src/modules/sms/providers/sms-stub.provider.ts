import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider, SmsSendResult } from '../interfaces/sms-provider.interface.js';

@Injectable()
export class SmsStubProvider implements SmsProvider {
  private readonly logger = new Logger(SmsStubProvider.name);
  public sentMessages: Array<{ to: string; message: string; senderId?: string }> = [];

  async sendSms(to: string, message: string, senderId?: string): Promise<SmsSendResult> {
    this.logger.log(`[STUB SMS] To: ${to} | Sender: ${senderId || 'DEFAULT'} | Body: ${message}`);
    this.sentMessages.push({ to, message, senderId });

    return {
      success: true,
      providerRef: `STUB-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      cost: 0.35,
    };
  }
}
