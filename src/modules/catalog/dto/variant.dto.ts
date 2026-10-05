import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsBoolean,
  IsNumber,
  Min,
  IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVariantDto {
  @ApiPropertyOptional({ description: 'Size UUID' })
  @IsUUID()
  @IsOptional()
  sizeId?: string;

  @ApiPropertyOptional({ description: 'Color UUID' })
  @IsUUID()
  @IsOptional()
  colorId?: string;

  @ApiPropertyOptional({ example: 'PANJ-M-BLU', description: 'Variant SKU (auto-generated if omitted)' })
  @IsString()
  @IsOptional()
  sku?: string;

  @ApiPropertyOptional({ example: '890123456789', description: 'Barcode (auto-generated if omitted)' })
  @IsString()
  @IsOptional()
  barcode?: string;

  @ApiProperty({ example: 2450.0, description: 'Retail price in BDT' })
  @IsNumber()
  @Min(0)
  retailPrice!: number;

  @ApiPropertyOptional({ example: 1950.0, default: 0, description: 'Wholesale price in BDT' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  wholesalePrice?: number;

  @ApiPropertyOptional({ example: 1400.0, default: 0, description: 'Unit cost price in BDT' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  costPrice?: number;

  @ApiPropertyOptional({ example: 5, default: 5, description: 'Reorder stock alert level' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  reorderLevel?: number;
}

export class UpdateVariantDto {
  @ApiPropertyOptional({ description: 'Size UUID' })
  @IsUUID()
  @IsOptional()
  sizeId?: string;

  @ApiPropertyOptional({ description: 'Color UUID' })
  @IsUUID()
  @IsOptional()
  colorId?: string;

  @ApiPropertyOptional({ example: 'PANJ-M-BLU-V2' })
  @IsString()
  @IsOptional()
  sku?: string;

  @ApiPropertyOptional({ example: '890123456799' })
  @IsString()
  @IsOptional()
  barcode?: string;

  @ApiPropertyOptional({ example: 2600.0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  retailPrice?: number;

  @ApiPropertyOptional({ example: 2100.0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  wholesalePrice?: number;

  @ApiPropertyOptional({ example: 1500.0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  costPrice?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  reorderLevel?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class BulkGenerateVariantsDto {
  @ApiProperty({ type: [String], description: 'List of Size UUIDs' })
  @IsArray()
  @IsUUID('all', { each: true })
  sizeIds!: string[];

  @ApiProperty({ type: [String], description: 'List of Color UUIDs' })
  @IsArray()
  @IsUUID('all', { each: true })
  colorIds!: string[];

  @ApiProperty({ example: 2450.0, description: 'Default retail price in BDT' })
  @IsNumber()
  @Min(0)
  defaultRetailPrice!: number;

  @ApiPropertyOptional({ example: 1950.0, default: 0, description: 'Default wholesale price in BDT' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  defaultWholesalePrice?: number;

  @ApiPropertyOptional({ example: 1400.0, default: 0, description: 'Default cost price in BDT' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  defaultCostPrice?: number;

  @ApiPropertyOptional({ example: 5, default: 5, description: 'Default reorder level' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  defaultReorderLevel?: number;
}
