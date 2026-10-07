import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ExpenseAttachmentDto {
  @ApiProperty({ description: 'File name' })
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @ApiProperty({ description: 'File size in bytes' })
  @IsNumber()
  fileSize!: number;

  @ApiProperty({ description: 'MIME type (e.g. image/jpeg, application/pdf)' })
  @IsString()
  @IsNotEmpty()
  mimeType!: string;

  @ApiPropertyOptional({ description: 'File content base64 encoded for disk stub' })
  @IsOptional()
  @IsString()
  fileContentBase64?: string;
}

export class CreateExpenseDto {
  @ApiProperty({ description: 'ExpenseCategory UUID' })
  @IsString()
  @IsNotEmpty()
  expenseCategoryId!: string;

  @ApiProperty({ description: 'Expense amount before tax (must be > 0)', example: 1200.0 })
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @ApiPropertyOptional({ description: 'Tax amount (default 0)', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  taxAmount?: number = 0;

  @ApiPropertyOptional({ description: 'Expense voucher date (ISO string)' })
  @IsOptional()
  @IsString()
  expenseDate?: string;

  @ApiPropertyOptional({ description: 'Vendor or payee name' })
  @IsOptional()
  @IsString()
  vendorName?: string;

  @ApiPropertyOptional({ description: 'External receipt or bill number' })
  @IsOptional()
  @IsString()
  receiptNo?: string;

  @ApiPropertyOptional({ description: 'Description / purpose' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Payment method label (CASH, BKASH, NAGAD, BANK)',
    default: 'CASH',
  })
  @IsOptional()
  @IsString()
  paymentMethod?: string = 'CASH';

  @ApiPropertyOptional({
    description: 'Whether expense was paid from drawer register (only valid with CASH; requires OPEN session)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  paidFromRegister?: boolean = false;

  @ApiPropertyOptional({ type: ExpenseAttachmentDto, description: 'Optional bill/receipt attachment' })
  @IsOptional()
  attachment?: ExpenseAttachmentDto;
}

export class UpdateExpenseDto {
  @ApiPropertyOptional({ description: 'ExpenseCategory UUID' })
  @IsOptional()
  @IsString()
  expenseCategoryId?: string;

  @ApiPropertyOptional({ description: 'Expense amount before tax' })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @ApiPropertyOptional({ description: 'Tax amount' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  taxAmount?: number;

  @ApiPropertyOptional({ description: 'Vendor name' })
  @IsOptional()
  @IsString()
  vendorName?: string;

  @ApiPropertyOptional({ description: 'Receipt / voucher number' })
  @IsOptional()
  @IsString()
  receiptNo?: string;

  @ApiPropertyOptional({ description: 'Description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Reason for update (required if session is closed)' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ExpenseQueryDto {
  @ApiPropertyOptional({ description: 'Filter by category UUID' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Filter by start date (ISO)' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Filter by end date (ISO)' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Page size', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 20;
}
