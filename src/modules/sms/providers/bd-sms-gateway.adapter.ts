import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider, SmsSendResult } from '../interfaces/sms-provider.interface.js';

@Injectable()
export class BdSmsGatewayAdapter implements SmsProvider {
  private readonly logger = new Logger(BdSmsGatewayAdapter.name);

  constructor(
    private readonly customHttpClient?: (url: string, options: any) => Promise<any>,
  ) {}

  async sendSms(to: string, message: string, senderId?: string): Promise<SmsSendResult> {
    const gatewayUrl = process.env.SMS_GATEWAY_URL || 'https://api.sms-bd-gateway.com/send';
    const apiKey = process.env.SMS_API_KEY || 'test-bd-gateway-key';
    const defaultSender = process.env.SMS_SENDER_ID || 'AarongPOS';

    const normalizedPhone = to.startsWith('+88')
      ? to
      : to.startsWith('88')
        ? `+${to}`
        : `+88${to}`;

    const payload = {
      api_key: apiKey,
      contacts: normalizedPhone,
      msg: message,
      senderid: senderId || defaultSender,
    };

    try {
      let responseData: any;

      if (this.customHttpClient) {
        responseData = await this.customHttpClient(gatewayUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        const res = await fetch(gatewayUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        responseData = await res.json().catch(() => ({}));
      }

      if (responseData.status === 'FAILED' || responseData.error) {
        return {
          success: false,
          errorMessage: responseData.error || 'Gateway returned failure status',
        };
      }

      return {
        success: true,
        providerRef: responseData.message_id || `BD-${Date.now()}`,
        cost: responseData.cost ?? 0.35,
      };
    } catch (err: any) {
      this.logger.error(`Failed to dispatch SMS via BD gateway: ${err.message}`);
      return {
        success: false,
        errorMessage: err.message,
      };
    }
  }
}
