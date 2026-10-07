import {
  IsString,
  IsOptional,
  IsNumber,
  IsUUID,
  IsArray,
  ValidateNested,
  IsEnum,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SaleType } from '../../../generated/prisma/client.js';

export class CartItemDto {
  @ApiPropertyOptional({ example: 'variant-uuid-1', description: 'Product Variant ID (optional if barcode provided)' })
  @IsUUID()
  @IsOptional()
  variantId?: string;

  @ApiPropertyOptional({ example: '8901234567890', description: 'Scanned barcode (SKU barcode or tracked unit barcode)' })
  @IsString()
  @IsOptional()
  barcode?: string;

  @ApiProperty({ example: 1, description: 'Quantity to purchase' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @ApiPropertyOptional({ example: 1200, description: 'Manual unit price override (requires sale.discount permission)' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  unitPrice?: number;

  @ApiPropertyOptional({ example: 50, description: 'Line discount amount in BDT' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  discountAmount?: number;

  @ApiPropertyOptional({ example: 'branch-uuid-2', description: 'Source branch ID for cross-branch auto-transfer' })
  @IsUUID()
  @IsOptional()
  sourceBranchId?: string;

  @ApiPropertyOptional({ example: 'unit-barcode-99', description: 'Specific tracked product unit barcode' })
  @IsString()
  @IsOptional()
  productUnitBarcode?: string;
}

export class CalculateSaleDto {
  @ApiProperty({ type: [CartItemDto], description: 'Items in the cart' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  items: CartItemDto[];

  @ApiPropertyOptional({ enum: SaleType, default: SaleType.RETAIL })
  @IsEnum(SaleType)
  @IsOptional()
  saleType?: SaleType = SaleType.RETAIL;

  @ApiPropertyOptional({ example: 'customer-uuid-1' })
  @IsUUID()
  @IsOptional()
  customerId?: string;

  @ApiPropertyOptional({ example: 'EID2026', description: 'Coupon promo code' })
  @IsString()
  @IsOptional()
  couponCode?: string;
}
