import { IsUUID, IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ActivateProductBranchDto {
  @ApiProperty({ description: 'Product UUID to activate' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ description: 'Branch UUID where product should be made active' })
  @IsUUID()
  branchId!: string;
}

export class DeactivateProductBranchDto {
  @ApiProperty({ description: 'Product UUID to deactivate' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ description: 'Branch UUID where product should be deactivated' })
  @IsUUID()
  branchId!: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Force deactivation even if current branch has active stock (> 0)',
  })
  @IsBoolean()
  @IsOptional()
  force?: boolean;
}
