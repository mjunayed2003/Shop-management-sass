import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SalesReturnItemDto } from './sales-return.dto.js';
import { CreateSaleItemDto, CreateSalePaymentDto } from './create-sale.dto.js';

export class CreateExchangeDto {
  @ApiPropertyOptional({ description: 'Original Sale UUID' })
  @IsOptional()
  @IsString()
  originalSaleId?: string;

  @ApiPropertyOptional({ description: 'Original Sale Invoice Number' })
  @IsOptional()
  @IsString()
  originalInvoiceNo?: string;

  @ApiProperty({
    type: [SalesReturnItemDto],
    description: 'Items returned in the exchange',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalesReturnItemDto)
  returnedItems!: SalesReturnItemDto[];

  @ApiProperty({
    type: [CreateSaleItemDto],
    description: 'New items taken in exchange',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSaleItemDto)
  newItems!: CreateSaleItemDto[];

  @ApiPropertyOptional({
    type: [CreateSalePaymentDto],
    description: 'Tender payments for difference when new items cost more than returned items',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSalePaymentDto)
  payments?: CreateSalePaymentDto[];

  @ApiProperty({ description: 'Unique idempotency key for exchange transaction' })
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;

  @ApiPropertyOptional({ description: 'Reason or notes for exchange' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ExchangeQueryDto {
  @ApiPropertyOptional({ description: 'Filter by original Sale UUID' })
  @IsOptional()
  @IsString()
  originalSaleId?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Page limit', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 20;
}
