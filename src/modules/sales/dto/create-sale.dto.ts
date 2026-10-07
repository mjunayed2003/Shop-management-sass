import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsUUID,
  IsArray,
  ValidateNested,
  IsEnum,
  IsBoolean,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SaleType, PaymentMethod } from '../../../generated/prisma/client.js';

export class CreateSalePaymentDto {
  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.CASH })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @ApiProperty({ example: 1500, description: 'Amount paid via this method in BDT' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiPropertyOptional({ example: 'TRX-12345678', description: 'Transaction ID for MFS/Bank/Cards' })
  @IsString()
  @IsOptional()
  transactionNo?: string;

  @ApiPropertyOptional({ example: 'pay-idem-1' })
  @IsString()
  @IsOptional()
  idempotencyKey?: string;
}

export class CreateSaleItemDto {
  @ApiPropertyOptional({ example: 'variant-uuid-1' })
  @IsUUID()
  @IsOptional()
  variantId?: string;

  @ApiPropertyOptional({ example: '8901234567890' })
  @IsString()
  @IsOptional()
  barcode?: string;

  @ApiProperty({ example: 1 })
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

  @ApiPropertyOptional({ example: 'unit-barcode-99', description: 'Single scanned unit barcode for tracked variant' })
  @IsString()
  @IsOptional()
  productUnitBarcode?: string;

  @ApiPropertyOptional({ example: ['unit-barcode-1', 'unit-barcode-2'], description: 'Multiple scanned unit barcodes for tracked variant' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  productUnitBarcodes?: string[];
}

export class CreateSaleDto {
  @ApiProperty({ example: 'idem-sale-20261006-001', description: 'Unique idempotency key for this sale' })
  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;

  @ApiPropertyOptional({ example: 'customer-uuid-1', description: 'Required for credit sales or wholesale' })
  @IsUUID()
  @IsOptional()
  customerId?: string;

  @ApiPropertyOptional({ enum: SaleType, default: SaleType.RETAIL })
  @IsEnum(SaleType)
  @IsOptional()
  saleType?: SaleType = SaleType.RETAIL;

  @ApiProperty({ type: [CreateSaleItemDto], description: 'Items in the cart' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSaleItemDto)
  items: CreateSaleItemDto[];

  @ApiProperty({ type: [CreateSalePaymentDto], description: 'List of payment tenders' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSalePaymentDto)
  payments: CreateSalePaymentDto[];

  @ApiPropertyOptional({ example: 'EID2026', description: 'Coupon promo code' })
  @IsString()
  @IsOptional()
  couponCode?: string;

  @ApiPropertyOptional({ example: 'VIP Customer discount applied' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ example: 'session-uuid-1', description: 'Cash register session ID (defaults to user active session)' })
  @IsUUID()
  @IsOptional()
  registerSessionId?: string;

  @ApiPropertyOptional({ example: false, default: false, description: 'True if captured offline' })
  @IsBoolean()
  @IsOptional()
  isOffline?: boolean = false;
}
