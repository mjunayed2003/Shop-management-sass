import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUnitDto {
  @ApiProperty({ example: 'Piece', description: 'Unit name' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'PCS', description: 'Unit code' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiPropertyOptional({ example: false, default: false, description: 'Whether unit allows decimal quantities (e.g. meter, yard)' })
  @IsBoolean()
  @IsOptional()
  allowDecimal?: boolean;
}

export class UpdateUnitDto {
  @ApiPropertyOptional({ example: 'Pieces' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'PCS' })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  allowDecimal?: boolean;
}
