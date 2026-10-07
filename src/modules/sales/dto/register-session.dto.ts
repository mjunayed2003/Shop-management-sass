import {
  IsUUID,
  IsNotEmpty,
  IsNumber,
  IsEnum,
  IsString,
  IsOptional,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CashMovementType } from '../../../generated/prisma/client.js';

export class OpenRegisterSessionDto {
  @ApiProperty({ example: 'reg-uuid-1' })
  @IsUUID()
  @IsNotEmpty()
  cashRegisterId!: string;

  @ApiProperty({ example: 2000, description: 'Opening cash drawer balance in BDT' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  openingBalance!: number;
}

export class CreateCashMovementDto {
  @ApiPropertyOptional({ description: 'Optional specific RegisterSession UUID (defaults to active user session)' })
  @IsOptional()
  @IsUUID()
  registerSessionId?: string;

  @ApiProperty({ enum: CashMovementType, description: 'PAY_IN or PAY_OUT' })
  @IsEnum(CashMovementType)
  type!: CashMovementType;

  @ApiProperty({ example: 500, description: 'Movement amount (must be > 0)' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @ApiProperty({ description: 'Mandatory reason for drawer cash movement' })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class CloseRegisterSessionDto {
  @ApiPropertyOptional({ description: 'Target session ID (required when manager closes another user session)' })
  @IsOptional()
  @IsUUID()
  registerSessionId?: string;

  @ApiProperty({ example: 5450, description: 'Physically counted cash balance at shift close' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  closingBalance!: number;

  @ApiPropertyOptional({
    description: 'Closing notes and/or currency denomination breakdown JSON string',
  })
  @IsOptional()
  @IsString()
  closingNotes?: string;
}

export class CashBookQueryDto {
  @ApiPropertyOptional({ description: 'Date in YYYY-MM-DD format (defaults to current date)' })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({ description: 'Specific branch UUID (for business owner/admin)' })
  @IsOptional()
  @IsString()
  branchId?: string;
}
