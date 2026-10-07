import { Module } from '@nestjs/common';
import { NotificationService } from './notifications.service.js';
import { NotificationController } from './notifications.controller.js';
import { NotificationCronService } from './notifications-cron.service.js';
import { PrismaModule } from '../../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationCronService],
  exports: [NotificationService, NotificationCronService],
})
export class NotificationsModule {}
