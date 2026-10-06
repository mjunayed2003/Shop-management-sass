import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsNumber,
  Min,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DamageStatus } from '../../../generated/prisma/client.js';

export class ReportDamagedStockDto {
  @ApiProperty({ example: 'a0000000-0000-0000-0000-000000000001' })
  @IsUUID()
  @IsNotEmpty()
  variantId: string;

  @ApiProperty({ example: 3 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @ApiProperty({ example: 'Torn seam / stained during display' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class DamagedStockQueryDto {
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

  @ApiPropertyOptional({ enum: DamageStatus })
  @IsEnum(DamageStatus)
  @IsOptional()
  status?: DamageStatus;
}
