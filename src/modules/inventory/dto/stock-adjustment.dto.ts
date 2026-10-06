import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsArray,
  ValidateNested,
  IsNumber,
  Min,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdjustmentReason, AdjustmentStatus } from '../../../generated/prisma/client.js';

export class CreateStockAdjustmentItemDto {
  @ApiProperty({ example: 'a0000000-0000-0000-0000-000000000001' })
  @IsUUID()
  @IsNotEmpty()
  variantId: string;

  @ApiProperty({ example: 48, description: 'Physically counted quantity' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  physicalQty: number;
}

export class CreateStockAdjustmentDto {
  @ApiProperty({ enum: AdjustmentReason, default: AdjustmentReason.PHYSICAL_COUNT_DISCREPANCY })
  @IsEnum(AdjustmentReason)
  reason: AdjustmentReason;

  @ApiPropertyOptional({ example: 'Year-end stock reconciliation' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ type: [CreateStockAdjustmentItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateStockAdjustmentItemDto)
  items: CreateStockAdjustmentItemDto[];
}

export class StockAdjustmentQueryDto {
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

  @ApiPropertyOptional({ enum: AdjustmentStatus })
  @IsEnum(AdjustmentStatus)
  @IsOptional()
  status?: AdjustmentStatus;

  @ApiPropertyOptional({ example: 'ADJ-001' })
  @IsString()
  @IsOptional()
  search?: string;
}
