import {
  IsOptional,
  IsString,
  IsEnum,
  IsUUID,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SaleStatus, SaleType } from '../../../generated/prisma/client.js';

export class SaleQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01T00:00:00.000Z' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-10-31T23:59:59.999Z' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ enum: SaleStatus })
  @IsOptional()
  @IsEnum(SaleStatus)
  status?: SaleStatus;

  @ApiPropertyOptional({ enum: SaleType })
  @IsOptional()
  @IsEnum(SaleType)
  saleType?: SaleType;

  @ApiPropertyOptional({ example: 'customer-uuid-1' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ example: 'user-uuid-1', description: 'Cashier/Creator User ID' })
  @IsOptional()
  @IsUUID()
  cashierId?: string;

  @ApiPropertyOptional({ example: 'session-uuid-1' })
  @IsOptional()
  @IsUUID()
  registerSessionId?: string;

  @ApiPropertyOptional({ example: 'INV-000001' })
  @IsOptional()
  @IsString()
  invoiceNo?: string;

  @ApiPropertyOptional({ example: 'branch-uuid-1', description: 'For all-branch admins to filter by branch' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 20;
}

export class DailySalesSummaryQueryDto {
  @ApiPropertyOptional({ example: '2026-10-06' })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({ example: 'branch-uuid-1' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class SalesReportQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ example: 'branch-uuid-1' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
