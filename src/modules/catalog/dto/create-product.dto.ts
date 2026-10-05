import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsEnum,
  IsBoolean,
  IsArray,
  ValidateNested,
  IsNumber,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Gender } from '../../../generated/prisma/client.js';

export class CreateProductVariantInputDto {
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

  @ApiPropertyOptional({ example: 5, default: 5, description: 'Minimum stock alert level' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  reorderLevel?: number;
}

export class CreateProductDto {
  @ApiProperty({ example: 'Premium Embroidered Cotton Panjabi', description: 'Product title' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'PANJ-EMB-01', description: 'Unique product style/design code' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({ description: 'Category UUID' })
  @IsUUID()
  categoryId!: string;

  @ApiPropertyOptional({ description: 'Brand UUID' })
  @IsUUID()
  @IsOptional()
  brandId?: string;

  @ApiPropertyOptional({ description: 'Season/Collection UUID' })
  @IsUUID()
  @IsOptional()
  seasonId?: string;

  @ApiProperty({ description: 'Unit UUID (e.g. Piece)' })
  @IsUUID()
  unitId!: string;

  @ApiPropertyOptional({ enum: Gender, default: Gender.UNISEX })
  @IsEnum(Gender)
  @IsOptional()
  gender?: Gender;

  @ApiPropertyOptional({ example: '100% Combed Cotton Jacquard' })
  @IsString()
  @IsOptional()
  fabric?: string;

  @ApiPropertyOptional({ example: 'Detailed description of the garment...' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ default: true, description: 'Has variant matrix (size/color)' })
  @IsBoolean()
  @IsOptional()
  hasVariants?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: 'Track each individual piece with unique serialized Code 128 barcode',
  })
  @IsBoolean()
  @IsOptional()
  trackIndividually?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: 'Admin optional multi-branch assignment list. Defaults to current branch if omitted.',
  })
  @IsArray()
  @IsUUID('all', { each: true })
  @IsOptional()
  branchIds?: string[];

  @ApiPropertyOptional({
    type: [CreateProductVariantInputDto],
    description: 'Initial variants list to create in the same single transaction',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProductVariantInputDto)
  @IsOptional()
  variants?: CreateProductVariantInputDto[];
}
