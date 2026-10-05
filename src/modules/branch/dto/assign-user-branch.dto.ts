import { IsString, IsNotEmpty, IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssignUserBranchDto {
  @ApiProperty({ description: 'User ID to assign to this branch' })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiPropertyOptional({ default: false, description: 'Set this branch as default branch for the user' })
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}
