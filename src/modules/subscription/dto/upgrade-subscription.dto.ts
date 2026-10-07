import { IsUUID, IsEnum, IsOptional, IsString } from 'class-validator';
import { BillingCycle } from '../../../generated/prisma/client.js';

export class UpgradeSubscriptionDto {
  @IsUUID()
  planId: string;

  @IsOptional()
  @IsEnum(BillingCycle)
  billingCycle?: BillingCycle;
}

export class CancelSubscriptionDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
