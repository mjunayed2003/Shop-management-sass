import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsUUID,
  IsArray,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class HoldCartItemDto {
  @ApiProperty({ example: 'variant-uuid-1' })
  @IsUUID()
  variantId: string;

  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @ApiPropertyOptional({ example: 1200 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  unitPrice?: number;

  @ApiPropertyOptional({ example: 50 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  discountAmount?: number;
}

export class HoldCartDto {
  @ApiProperty({ example: 'Customer Waiting for Wallet - Table 2' })
  @IsString()
  @IsNotEmpty()
  referenceName: string;

  @ApiPropertyOptional({ example: 'customer-uuid-1' })
  @IsUUID()
  @IsOptional()
  customerId?: string;

  @ApiProperty({ type: [HoldCartItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HoldCartItemDto)
  items: HoldCartItemDto[];
}
