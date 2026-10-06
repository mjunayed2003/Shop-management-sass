import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsNumber,
  Min,
  IsDateString,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '../../../generated/prisma/client.js';

export class CreateSupplierPaymentDto {
  @ApiProperty({ example: 's0000000-0000-0000-0000-000000000001' })
  @IsUUID()
  @IsNotEmpty()
  supplierId: string;

  @ApiPropertyOptional({ example: 'p0000000-0000-0000-0000-000000000001' })
  @IsUUID()
  @IsOptional()
  purchaseId?: string;

  @ApiProperty({ example: 5000 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ enum: PaymentMethod, default: PaymentMethod.BANK })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @ApiPropertyOptional({ example: 'TXN-998822' })
  @IsString()
  @IsOptional()
  referenceNo?: string;

  @ApiPropertyOptional({ example: '2026-10-06T12:00:00Z' })
  @IsDateString()
  @IsOptional()
  paymentDate?: string;

  @ApiPropertyOptional({ example: 'Partial installment payment' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class SupplierPaymentQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  limit?: number = 20;

  @ApiPropertyOptional({ example: 's0000000-0000-0000-0000-000000000001' })
  @IsUUID()
  @IsOptional()
  supplierId?: string;

  @ApiPropertyOptional({ example: 'p0000000-0000-0000-0000-000000000001' })
  @IsUUID()
  @IsOptional()
  purchaseId?: string;

  @ApiPropertyOptional({ example: 'PAY-001' })
  @IsString()
  @IsOptional()
  search?: string;
}
