import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBrandDto {
  @ApiProperty({ example: 'Taaga', description: 'Brand name' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'TAAGA', description: 'Unique brand code per business' })
  @IsString()
  @IsNotEmpty()
  code!: string;
}

export class UpdateBrandDto {
  @ApiPropertyOptional({ example: 'Taaga Man' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'TAAGA-MAN' })
  @IsString()
  @IsOptional()
  code?: string;
}
