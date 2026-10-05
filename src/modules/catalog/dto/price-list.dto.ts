import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsUUID,
  IsNumber,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PriceListType } from '../../../generated/prisma/client.js';

export class CreatePriceListDto {
  @ApiProperty({ example: 'Eid-ul-Fitr Festive Offer', description: 'Price list name' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'EID-OFFER-2026', description: 'Unique price list code' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiPropertyOptional({ enum: PriceListType, default: PriceListType.RETAIL })
  @IsEnum(PriceListType)
  @IsOptional()
  type?: PriceListType;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdatePriceListDto {
  @ApiPropertyOptional({ example: 'Eid-ul-Fitr Promotional Price List' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'EID-PROMO-2026' })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ enum: PriceListType })
  @IsEnum(PriceListType)
  @IsOptional()
  type?: PriceListType;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class SetPriceListItemDto {
  @ApiProperty({ description: 'Product Variant UUID' })
  @IsUUID()
  variantId!: string;

  @ApiProperty({ example: 2199.0, description: 'Price for this variant under this price list' })
  @IsNumber()
  @Min(0)
  price!: number;
}
