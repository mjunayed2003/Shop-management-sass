import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsNumber,
  Min,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSupplierDto {
  @ApiProperty({ example: 'Apex Textiles Ltd.' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'SUP-001' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiPropertyOptional({ example: 'Apex Holdings' })
  @IsString()
  @IsOptional()
  companyName?: string;

  @ApiProperty({ example: '+8801711223344' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiPropertyOptional({ example: 'contact@apextextiles.com' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: 'Tejgaon I/A, Dhaka' })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ example: 'Dhaka' })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({ example: 0, default: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  openingBalance?: number;
}

export class UpdateSupplierDto {
  @ApiPropertyOptional({ example: 'Apex Textiles Ltd.' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'Apex Holdings' })
  @IsString()
  @IsOptional()
  companyName?: string;

  @ApiPropertyOptional({ example: '+8801711223344' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: 'contact@apextextiles.com' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: 'Tejgaon I/A, Dhaka' })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ example: 'Dhaka' })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({ example: true })
  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class SupplierQueryDto {
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

  @ApiPropertyOptional({ example: 'Apex' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ example: true })
  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class SupplierLedgerQueryDto {
  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsString()
  @IsOptional()
  endDate?: string;
}
