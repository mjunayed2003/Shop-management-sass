import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    example: 'owner@aarongfashion.com',
    description: 'Email or mobile phone number of the user',
  })
  @IsNotEmpty({ message: 'Email or phone number is required' })
  @IsString()
  identifier!: string;

  @ApiProperty({
    example: 'SecretPass123!',
    description: 'User login password',
  })
  @IsNotEmpty({ message: 'Password is required' })
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  password!: string;

  @ApiPropertyOptional({
    example: 'aarong-fashion',
    description: 'Business unique slug (optional for disambiguation)',
  })
  @IsOptional()
  @IsString()
  businessSlug?: string;
}
