import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VoidSaleDto {
  @ApiProperty({ example: 'Customer returned items immediately / wrong items scanned by mistake', description: 'Mandatory reason for voiding this invoice' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
