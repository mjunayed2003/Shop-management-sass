import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '../../../generated/prisma/client.js';

export class CreateDueCollectionDto {
  @ApiProperty({ description: 'Customer UUID' })
  @IsString()
  @IsNotEmpty()
  customerId!: string;

  @ApiProperty({ description: 'Payment amount (must be > 0)', example: 1500.0 })
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @ApiProperty({
    enum: PaymentMethod,
    default: PaymentMethod.CASH,
    description: 'Payment method label',
  })
  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  @ApiPropertyOptional({ description: 'Transaction / reference number for non-cash' })
  @IsOptional()
  @IsString()
  transactionNo?: string;

  @ApiPropertyOptional({ description: 'Collection remarks or notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ description: 'Unique idempotency key' })
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}

export class DueCollectionQueryDto {
  @ApiPropertyOptional({ description: 'Filter by Customer UUID' })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Page size', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 20;
}
