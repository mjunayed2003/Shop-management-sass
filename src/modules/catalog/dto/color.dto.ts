import { IsString, IsNotEmpty, IsOptional, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateColorDto {
  @ApiProperty({ example: 'Royal Blue', description: 'Color name' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'RBLU', description: 'Color code' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiPropertyOptional({ example: '#4169E1', description: 'HEX color code' })
  @IsString()
  @Matches(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, {
    message: 'Hex code must be a valid hex color starting with #',
  })
  @IsOptional()
  hexCode?: string;
}

export class UpdateColorDto {
  @ApiPropertyOptional({ example: 'Deep Royal Blue' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'DRBLU' })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ example: '#002366' })
  @IsString()
  @Matches(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, {
    message: 'Hex code must be a valid hex color starting with #',
  })
  @IsOptional()
  hexCode?: string;
}
