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
import { StockTransferStatus } from '../../../generated/prisma/client.js';

export class CreateStockTransferItemDto {
  @ApiProperty({ example: 'a0000000-0000-0000-0000-000000000001' })
  @IsUUID()
  @IsNotEmpty()
  variantId: string;

  @ApiProperty({ example: 10 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  sentQty: number;
}

export class CreateStockTransferDto {
  @ApiProperty({ example: 'b0000000-0000-0000-0000-000000000002' })
  @IsUUID()
  @IsNotEmpty()
  toBranchId: string;

  @ApiPropertyOptional({ example: 'Transfer to Dhanmondi showroom for festive demand' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ type: [CreateStockTransferItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateStockTransferItemDto)
  items: CreateStockTransferItemDto[];
}

export class ReceiveTransferItemDto {
  @ApiProperty({ example: 'item-uuid-1' })
  @IsUUID()
  @IsNotEmpty()
  itemId: string;

  @ApiProperty({ example: 10 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  receivedQty: number;

  @ApiPropertyOptional({ example: '1 unit missing during delivery' })
  @IsString()
  @IsOptional()
  discrepancyNote?: string;
}

export class ReceiveTransferDto {
  @ApiProperty({ type: [ReceiveTransferItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveTransferItemDto)
  items: ReceiveTransferItemDto[];
}

export class InstantTransferItemDto {
  @ApiProperty({ example: 'a0000000-0000-0000-0000-000000000001' })
  @IsUUID()
  @IsNotEmpty()
  variantId: string;

  @ApiProperty({ example: 5 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  quantity: number;
}

export class InstantTransferDto {
  @ApiProperty({ example: 'b0000000-0000-0000-0000-000000000001' })
  @IsUUID()
  @IsNotEmpty()
  fromBranchId: string;

  @ApiProperty({ example: 'b0000000-0000-0000-0000-000000000002' })
  @IsUUID()
  @IsNotEmpty()
  toBranchId: string;

  @ApiPropertyOptional({ example: 'idemp-transfer-123' })
  @IsString()
  @IsOptional()
  idempotencyKey?: string;

  @ApiPropertyOptional({ example: 'Auto-transfer during cross-branch sale' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ type: [InstantTransferItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InstantTransferItemDto)
  items: InstantTransferItemDto[];
}

export class StockTransferQueryDto {
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

  @ApiPropertyOptional({ enum: StockTransferStatus })
  @IsEnum(StockTransferStatus)
  @IsOptional()
  status?: StockTransferStatus;

  @ApiPropertyOptional({ example: 'TRN-001' })
  @IsString()
  @IsOptional()
  search?: string;
}
