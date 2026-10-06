import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsArray,
  ValidateNested,
  IsNumber,
  Min,
  IsBoolean,
  IsDateString,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod, PurchaseStatus } from '../../../generated/prisma/client.js';

export class CreatePurchaseItemDto {
  @ApiProperty({ example: 'a0000000-0000-0000-0000-000000000001' })
  @IsUUID()
  @IsNotEmpty()
  variantId: string;

  @ApiProperty({ example: 20 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @ApiProperty({ example: 450 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitCost: number;

  @ApiPropertyOptional({ example: 5, default: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  vatPercentage?: number;
}

export class CreatePurchaseDto {
  @ApiProperty({ example: 's0000000-0000-0000-0000-000000000001' })
  @IsUUID()
  @IsNotEmpty()
  supplierId: string;

  @ApiPropertyOptional({ example: 'po000000-0000-0000-0000-000000000001' })
  @IsUUID()
  @IsOptional()
  purchaseOrderId?: string;

  @ApiPropertyOptional({ example: 'INV-APEX-9921' })
  @IsString()
  @IsOptional()
  supplierInvoiceNo?: string;

  @ApiPropertyOptional({ example: '2026-10-06T10:00:00Z' })
  @IsDateString()
  @IsOptional()
  purchaseDate?: string;

  @ApiPropertyOptional({ example: 500, default: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  discountAmount?: number;

  @ApiPropertyOptional({ example: 250, default: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  taxAmount?: number;

  @ApiPropertyOptional({ example: 300, default: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  shippingCost?: number;

  @ApiPropertyOptional({ example: 5000, default: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  paidAmount?: number;

  @ApiPropertyOptional({ enum: PaymentMethod, default: PaymentMethod.BANK })
  @IsEnum(PaymentMethod)
  @IsOptional()
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ example: 'CHQ-99120' })
  @IsString()
  @IsOptional()
  paymentReference?: string;

  @ApiPropertyOptional({ example: false, default: false })
  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  landedCost?: boolean = false;

  @ApiPropertyOptional({ example: 'Winter consignment arrival' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ type: [CreatePurchaseItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseItemDto)
  items: CreatePurchaseItemDto[];
}

export class PurchaseQueryDto {
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

  @ApiPropertyOptional({ enum: PurchaseStatus })
  @IsEnum(PurchaseStatus)
  @IsOptional()
  status?: PurchaseStatus;

  @ApiPropertyOptional({ example: 's0000000-0000-0000-0000-000000000001' })
  @IsUUID()
  @IsOptional()
  supplierId?: string;

  @ApiPropertyOptional({ example: 'PUR-001' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsDateString()
  @IsOptional()
  endDate?: string;
}
