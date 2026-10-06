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
import { ReturnStatus } from '../../../generated/prisma/client.js';

export class CreatePurchaseReturnItemDto {
  @ApiProperty({ example: 'a0000000-0000-0000-0000-000000000001' })
  @IsUUID()
  @IsNotEmpty()
  variantId: string;

  @ApiProperty({ example: 2 })
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

export class CreatePurchaseReturnDto {
  @ApiProperty({ example: 's0000000-0000-0000-0000-000000000001' })
  @IsUUID()
  @IsNotEmpty()
  supplierId: string;

  @ApiPropertyOptional({ example: 'p0000000-0000-0000-0000-000000000001' })
  @IsUUID()
  @IsOptional()
  purchaseId?: string;

  @ApiPropertyOptional({ example: 'Damaged fabric / color bleeding' })
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiPropertyOptional({ enum: ReturnStatus, default: ReturnStatus.COMPLETED })
  @IsEnum(ReturnStatus)
  @IsOptional()
  status?: ReturnStatus = ReturnStatus.COMPLETED;

  @ApiProperty({ type: [CreatePurchaseReturnItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseReturnItemDto)
  items: CreatePurchaseReturnItemDto[];
}

export class PurchaseReturnQueryDto {
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

  @ApiPropertyOptional({ enum: ReturnStatus })
  @IsEnum(ReturnStatus)
  @IsOptional()
  status?: ReturnStatus;

  @ApiPropertyOptional({ example: 's0000000-0000-0000-0000-000000000001' })
  @IsUUID()
  @IsOptional()
  supplierId?: string;

  @ApiPropertyOptional({ example: 'p0000000-0000-0000-0000-000000000001' })
  @IsUUID()
  @IsOptional()
  purchaseId?: string;
}
