import {
  IsUUID,
  IsEnum,
  IsInt,
  Min,
  IsOptional,
  IsString,
  ValidateIf,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BarcodePrintType } from '../../../generated/prisma/client.js';

export class PrintBarcodeDto {
  @ApiProperty({ description: 'Product Variant UUID' })
  @IsUUID()
  variantId!: string;

  @ApiPropertyOptional({ description: 'Specific physical unit UUID if individually tracked' })
  @IsUUID()
  @IsOptional()
  productUnitId?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1, description: 'Number of labels to print' })
  @IsInt()
  @Min(1)
  @IsOptional()
  quantity: number = 1;

  @ApiPropertyOptional({ enum: BarcodePrintType, default: BarcodePrintType.INITIAL_PRINT })
  @IsEnum(BarcodePrintType)
  @IsOptional()
  printType: BarcodePrintType = BarcodePrintType.INITIAL_PRINT;

  @ApiPropertyOptional({
    description: 'Mandatory reason explaining why barcode is being reprinted (when printType is REPRINT)',
  })
  @ValidateIf((o) => o.printType === BarcodePrintType.REPRINT)
  @IsNotEmpty({ message: 'A reason must be provided when reprinting barcode labels' })
  @IsString()
  reason?: string;
}
