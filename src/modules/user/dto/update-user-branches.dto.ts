import { IsArray, ArrayMinSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { UserBranchAssignmentDto } from './create-user.dto.js';

export class UpdateUserBranchesDto {
  @ApiProperty({
    type: [UserBranchAssignmentDto],
    description: 'Updated list of accessible branches. Must contain at least one branch.',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'A user must have access to at least one branch.' })
  @ValidateNested({ each: true })
  @Type(() => UserBranchAssignmentDto)
  branches!: UserBranchAssignmentDto[];
}
