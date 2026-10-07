import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ProfitReportQueryDto {
  @ApiPropertyOptional({ description: 'Start date in ISO or YYYY-MM-DD format' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date in ISO or YYYY-MM-DD format' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Specific branch UUID (for business owner/admin)' })
  @IsOptional()
  @IsString()
  branchId?: string;
}

export class CollectionsSummaryQueryDto {
  @ApiPropertyOptional({ description: 'Start date in ISO or YYYY-MM-DD format' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date in ISO or YYYY-MM-DD format' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Specific branch UUID (for business owner/admin)' })
  @IsOptional()
  @IsString()
  branchId?: string;
}
