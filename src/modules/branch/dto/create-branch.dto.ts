import { IsString, IsNotEmpty, IsOptional, IsEmail } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBranchDto {
  @ApiProperty({ example: 'Dhanmondi Showroom', description: 'Branch display name' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'DHANMONDI', description: 'Unique short code for branch (within business)' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({ example: 'House 27, Road 4, Dhanmondi', description: 'Showroom physical address' })
  @IsString()
  @IsNotEmpty()
  address!: string;

  @ApiPropertyOptional({ example: 'Dhaka', default: 'Dhaka' })
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

  @ApiProperty({ example: '01722334455', description: 'Branch contact phone' })
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @ApiPropertyOptional({ example: 'dhanmondi@aarong-boutique.com' })
  @IsEmail()
  @IsOptional()
  email?: string;
}
