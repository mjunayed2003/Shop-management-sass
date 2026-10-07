import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SmsService } from './services/sms.service.js';
import { SmsTemplateService } from './services/sms-template.service.js';
import { SmsWorkerService } from './services/sms-worker.service.js';
import { SmsStubProvider } from './providers/sms-stub.provider.js';
import { BdSmsGatewayAdapter } from './providers/bd-sms-gateway.adapter.js';
import { SMS_PROVIDER_TOKEN } from './interfaces/sms-provider.interface.js';
import { SmsController } from './controllers/sms.controller.js';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [SmsController],
  providers: [
    SmsService,
    SmsTemplateService,
    SmsWorkerService,
    SmsStubProvider,
    BdSmsGatewayAdapter,
    {
      provide: SMS_PROVIDER_TOKEN,
      useClass: process.env.SMS_PROVIDER === 'BD_GATEWAY' ? BdSmsGatewayAdapter : SmsStubProvider,
    },
  ],
  exports: [SmsService, SmsWorkerService, SmsTemplateService, SMS_PROVIDER_TOKEN],
})
export class SmsModule {}
