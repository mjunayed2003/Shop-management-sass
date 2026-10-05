import { IsString, IsNotEmpty, IsOptional, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSizeDto {
  @ApiProperty({ example: 'XL (42)', description: 'Size display label' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: '42', description: 'Size short code' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiPropertyOptional({ example: 4, default: 0, description: 'Display sort order' })
  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}

export class UpdateSizeDto {
  @ApiPropertyOptional({ example: 'XL (42 Slim)' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: '42S' })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ example: 5 })
  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}
