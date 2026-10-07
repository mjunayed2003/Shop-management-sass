import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
  IsEnum,
  IsNumber,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ItemCondition, RefundMethod } from '../../../generated/prisma/client.js';

export class SalesReturnItemDto {
  @ApiProperty({ description: 'UUID of the original SaleItem' })
  @IsString()
  @IsNotEmpty()
  saleItemId!: string;

  @ApiProperty({ description: 'Quantity to return (must be > 0)', example: 1 })
  @IsNumber()
  @Min(0.0001)
  quantity!: number;

  @ApiPropertyOptional({
    enum: ItemCondition,
    default: ItemCondition.RESELLABLE,
    description: 'Condition of the returned item (RESELLABLE or DAMAGED)',
  })
  @IsOptional()
  @IsEnum(ItemCondition)
  condition?: ItemCondition = ItemCondition.RESELLABLE;

  @ApiPropertyOptional({
    type: [String],
    description: 'Tracked unit barcodes when returning individually tracked items',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  trackedUnitBarcodes?: string[];
}

export class CreateSalesReturnDto {
  @ApiPropertyOptional({ description: 'Original Sale UUID' })
  @IsOptional()
  @IsString()
  saleId?: string;

  @ApiPropertyOptional({ description: 'Original Sale Invoice Number' })
  @IsOptional()
  @IsString()
  invoiceNo?: string;

  @ApiProperty({ type: [SalesReturnItemDto], description: 'Items to return' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalesReturnItemDto)
  items!: SalesReturnItemDto[];

  @ApiProperty({
    enum: RefundMethod,
    default: RefundMethod.CASH,
    description: 'Refund tender method',
  })
  @IsEnum(RefundMethod)
  refundMethod!: RefundMethod;

  @ApiPropertyOptional({ description: 'Reason for return' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiProperty({ description: 'Unique idempotency key for this return request' })
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}

export class SalesReturnQueryDto {
  @ApiPropertyOptional({ description: 'Filter by original Sale UUID' })
  @IsOptional()
  @IsString()
  saleId?: string;

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
