import {
  IsString,
  IsOptional,
  IsUUID,
  IsNumber,
  Min,
  IsBoolean,
  IsEnum,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  Gender,
  StockMovementType,
  StockReferenceType,
} from '../../../generated/prisma/client.js';

export class CurrentStockQueryDto {
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

  @ApiPropertyOptional({ example: 'brand-uuid-1' })
  @IsUUID()
  @IsOptional()
  brandId?: string;

  @ApiPropertyOptional({ example: 'category-uuid-1' })
  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @ApiPropertyOptional({ example: 'season-uuid-1' })
  @IsUUID()
  @IsOptional()
  seasonId?: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsEnum(Gender)
  @IsOptional()
  gender?: Gender;

  @ApiPropertyOptional({ example: true, description: 'Only products below or at reorder level' })
  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  lowStockOnly?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Only products with 0 quantity' })
  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  zeroStockOnly?: boolean;

  @ApiPropertyOptional({ example: 'Panjabi' })
  @IsString()
  @IsOptional()
  search?: string;
}

export class StockMovementQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ example: 50, default: 50 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  limit?: number = 50;

  @ApiPropertyOptional({ example: 'variant-uuid-1' })
  @IsUUID()
  @IsOptional()
  variantId?: string;

  @ApiPropertyOptional({ enum: StockMovementType })
  @IsEnum(StockMovementType)
  @IsOptional()
  movementType?: StockMovementType;

  @ApiPropertyOptional({ enum: StockReferenceType })
  @IsEnum(StockReferenceType)
  @IsOptional()
  referenceType?: StockReferenceType;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsDateString()
  @IsOptional()
  endDate?: string;
}

export class OpeningStockDto {
  @ApiPropertyOptional({ example: 'variant-uuid-1' })
  @IsUUID()
  variantId: string;

  @ApiPropertyOptional({ example: 100 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @ApiPropertyOptional({ example: 350 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitCost: number;
}
