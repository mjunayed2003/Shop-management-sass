import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsArray,
  ValidateNested,
  IsNumber,
  Min,
  IsDateString,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { POStatus } from '../../../generated/prisma/client.js';

export class CreatePurchaseOrderItemDto {
  @ApiProperty({ example: 'a0000000-0000-0000-0000-000000000001' })
  @IsUUID()
  @IsNotEmpty()
  variantId: string;

  @ApiProperty({ example: 50 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @ApiProperty({ example: 450 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitCost: number;
}

export class CreatePurchaseOrderDto {
  @ApiProperty({ example: 's0000000-0000-0000-0000-000000000001' })
  @IsUUID()
  @IsNotEmpty()
  supplierId: string;

  @ApiPropertyOptional({ example: '2026-10-20' })
  @IsDateString()
  @IsOptional()
  expectedDelivery?: string;

  @ApiPropertyOptional({ example: 'Urgent winter order' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ type: [CreatePurchaseOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderItemDto)
  items: CreatePurchaseOrderItemDto[];
}

export class UpdatePurchaseOrderDto {
  @ApiPropertyOptional({ example: 's0000000-0000-0000-0000-000000000001' })
  @IsUUID()
  @IsOptional()
  supplierId?: string;

  @ApiPropertyOptional({ example: '2026-10-25' })
  @IsDateString()
  @IsOptional()
  expectedDelivery?: string;

  @ApiPropertyOptional({ example: 'Updated notes' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ type: [CreatePurchaseOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderItemDto)
  @IsOptional()
  items?: CreatePurchaseOrderItemDto[];
}

export class PurchaseOrderQueryDto {
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

  @ApiPropertyOptional({ enum: POStatus })
  @IsEnum(POStatus)
  @IsOptional()
  status?: POStatus;

  @ApiPropertyOptional({ example: 's0000000-0000-0000-0000-000000000001' })
  @IsUUID()
  @IsOptional()
  supplierId?: string;

  @ApiPropertyOptional({ example: 'PO-001' })
  @IsString()
  @IsOptional()
  search?: string;
}
