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

export class CreateCustomerDto {
  @ApiProperty({ example: 'Tanvir Ahmed' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: '+8801711223344', description: 'Any BD mobile format (normalized to 01XXXXXXXXX)' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiPropertyOptional({ example: 'tanvir@gmail.com' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: 'House 12, Road 5, Dhanmondi, Dhaka' })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ example: 0, default: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  openingDue?: number;

  @ApiPropertyOptional({ example: 10000, default: 0, description: 'Maximum allowed credit limit' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  creditLimit?: number;
}

export class QuickCreateCustomerDto {
  @ApiProperty({ example: 'Tanvir Ahmed' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: '01711223344' })
  @IsString()
  @IsNotEmpty()
  phone: string;
}

export class UpdateCustomerDto {
  @ApiPropertyOptional({ example: 'Tanvir Ahmed' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: '01711223344' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: 'tanvir@gmail.com' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: 'House 12, Road 5, Dhanmondi, Dhaka' })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ example: 15000 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  creditLimit?: number;

  @ApiPropertyOptional({ example: true })
  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class CustomerQueryDto {
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

  @ApiPropertyOptional({ example: 'Tanvir' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ example: true })
  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class CustomerLedgerQueryDto {
  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsString()
  @IsOptional()
  endDate?: string;
}
