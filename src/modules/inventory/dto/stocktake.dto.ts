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
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StocktakeStatus } from '../../../generated/prisma/client.js';

export class StartStocktakeDto {
  @ApiPropertyOptional({ example: 'cat-uuid-1' })
  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @ApiPropertyOptional({ example: 'brand-uuid-1' })
  @IsUUID()
  @IsOptional()
  brandId?: string;

  @ApiPropertyOptional({ example: 'Monthly physical stock audit' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class RecordStocktakeCountItemDto {
  @ApiProperty({ example: 'item-uuid-1' })
  @IsUUID()
  @IsNotEmpty()
  itemId: string;

  @ApiProperty({ example: 45 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  countedQty: number;
}

export class RecordStocktakeCountsDto {
  @ApiProperty({ type: [RecordStocktakeCountItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecordStocktakeCountItemDto)
  counts: RecordStocktakeCountItemDto[];
}

export class CompleteStocktakeDto {
  @ApiPropertyOptional({ example: true, default: false, description: 'Automatically generate DRAFT stock adjustment from discrepancies' })
  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  createAdjustment?: boolean = false;
}

export class StocktakeQueryDto {
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

  @ApiPropertyOptional({ enum: StocktakeStatus })
  @IsEnum(StocktakeStatus)
  @IsOptional()
  status?: StocktakeStatus;
}
