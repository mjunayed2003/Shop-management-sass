import { IsString, IsNotEmpty, IsOptional, IsUUID, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({ example: "Men's Panjabi", description: 'Category name' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'MENS-PANJABI', description: 'Unique category code per business' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiPropertyOptional({ example: 'Traditional and festive Panjabis for men' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'uuid', description: 'Parent category UUID for hierarchical categorization' })
  @IsUUID()
  @IsOptional()
  parentId?: string;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({ example: "Men's Luxury Panjabi" })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'MENS-PANJABI-LUX' })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ example: 'Updated description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'uuid' })
  @IsUUID()
  @IsOptional()
  parentId?: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
