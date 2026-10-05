import { IsString, IsOptional, IsEmail, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateBranchDto {
  @ApiPropertyOptional({ example: 'Dhanmondi Flagship Outlet' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'House 28, Road 4, Dhanmondi' })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ example: 'Dhaka' })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({ example: 'Dhaka Division' })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiPropertyOptional({ example: '1209' })
  @IsString()
  @IsOptional()
  postalCode?: string;

  @ApiPropertyOptional({ example: '01722334466' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: 'dhanmondi@aarong-boutique.com' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: true, description: 'Active status of the branch' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
