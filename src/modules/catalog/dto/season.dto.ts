import { IsString, IsNotEmpty, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSeasonDto {
  @ApiProperty({ example: 'Eid Collection 2026', description: 'Season or collection name' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'EID-2026', description: 'Unique season code per business' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiPropertyOptional({ example: '2026-03-01T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-04-30T23:59:59.000Z' })
  @IsDateString()
  @IsOptional()
  endDate?: string;
}

export class UpdateSeasonDto {
  @ApiPropertyOptional({ example: 'Eid-ul-Fitr 2026 Collection' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'EID-FITR-2026' })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ example: '2026-03-01T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-05-15T23:59:59.000Z' })
  @IsDateString()
  @IsOptional()
  endDate?: string;
}
