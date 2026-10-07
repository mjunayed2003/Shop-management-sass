export interface SmsSendResult {
  success: boolean;
  providerRef?: string;
  cost?: number;
  errorMessage?: string;
}

export interface SmsProvider {
  sendSms(to: string, message: string, senderId?: string): Promise<SmsSendResult>;
}

export const SMS_PROVIDER_TOKEN = 'SMS_PROVIDER_TOKEN';
