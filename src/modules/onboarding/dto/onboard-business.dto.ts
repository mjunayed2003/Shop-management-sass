import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsOptional,
  MinLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OnboardBusinessDto {
  // Business Information
  @ApiProperty({ example: 'Aarong Fashion Boutique', description: 'Business display name' })
  @IsString()
  @IsNotEmpty()
  businessName!: string;

  @ApiProperty({
    example: 'aarong-boutique',
    description: 'Unique URL slug for business identifier',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'Slug must contain only lowercase letters, numbers, and hyphens',
  })
  businessSlug!: string;

  @ApiPropertyOptional({ example: 'Aarong Retail Bangladesh Ltd.' })
  @IsString()
  @IsOptional()
  legalName?: string;

  @ApiProperty({ example: '01711000111', description: 'Business primary phone number' })
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @ApiProperty({ example: 'contact@aarong-boutique.com', description: 'Business email address' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ example: 'BDT', default: 'BDT' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({ example: 'Asia/Dhaka', default: 'Asia/Dhaka' })
  @IsString()
  @IsOptional()
  timezone?: string;

  // Owner User Information
  @ApiProperty({ example: 'Kamal', description: 'Owner first name' })
  @IsString()
  @IsNotEmpty()
  ownerFirstName!: string;

  @ApiProperty({ example: 'Hossain', description: 'Owner last name' })
  @IsString()
  @IsNotEmpty()
  ownerLastName!: string;

  @ApiPropertyOptional({
    example: 'kamal@aarong-boutique.com',
    description: 'Owner email (defaults to business email if omitted)',
  })
  @IsEmail()
  @IsOptional()
  ownerEmail?: string;

  @ApiPropertyOptional({
    example: '01711000111',
    description: 'Owner phone (defaults to business phone if omitted)',
  })
  @IsString()
  @IsOptional()
  ownerPhone?: string;

  @ApiProperty({ example: 'Password123!', minLength: 6, description: 'Owner login password' })
  @IsString()
  @MinLength(6)
  password!: string;

  // Main Branch Information
  @ApiProperty({ example: 'Gulshan Flagship Showroom', description: 'Main branch display name' })
  @IsString()
  @IsNotEmpty()
  branchName!: string;

  @ApiPropertyOptional({ example: 'MAIN', default: 'MAIN', description: 'Branch short code' })
  @IsString()
  @IsOptional()
  branchCode?: string;

  @ApiProperty({ example: 'House 12, Road 11, Gulshan-1', description: 'Showroom physical address' })
  @IsString()
  @IsNotEmpty()
  branchAddress!: string;

  @ApiPropertyOptional({ example: 'Dhaka', default: 'Dhaka' })
  @IsString()
  @IsOptional()
  branchCity?: string;

  @ApiPropertyOptional({ example: '01711000112' })
  @IsString()
  @IsOptional()
  branchPhone?: string;

  // Subscription Plan
  @ApiPropertyOptional({
    example: 'STARTER',
    default: 'STARTER',
    description: 'Initial trial plan code (e.g. STARTER, BUSINESS)',
  })
  @IsString()
  @IsOptional()
  planCode?: string;
}
