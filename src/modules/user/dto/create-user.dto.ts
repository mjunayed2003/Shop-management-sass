import {
  IsString,
  IsNotEmpty,
  IsEmail,
  MinLength,
  IsUUID,
  IsArray,
  ArrayMinSize,
  ValidateNested,
  IsBoolean,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserBranchAssignmentDto {
  @ApiProperty({ example: 'b8c6a2e1-4567-4d9f-9abc-1234567890ab', description: 'Branch UUID' })
  @IsUUID()
  branchId!: string;

  @ApiPropertyOptional({ example: false, default: false, description: 'Whether this branch is default for the user' })
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}

export class CreateUserDto {
  @ApiProperty({ example: 'Tanvir', description: 'First name' })
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @ApiProperty({ example: 'Ahmed', description: 'Last name' })
  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @ApiProperty({ example: 'tanvir@shop.com', description: 'Email address' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: '01712345678', description: 'Bangladesh mobile phone number' })
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @ApiProperty({ example: 'Secret123!', minLength: 6, description: 'Initial login password' })
  @IsString()
  @MinLength(6)
  password!: string;

  @ApiProperty({ example: '7d6c5b4a-1234-4567-89ab-cdef01234567', description: 'Assigned Role UUID' })
  @IsUUID()
  roleId!: string;

  @ApiProperty({
    type: [UserBranchAssignmentDto],
    description: 'Accessible branches. Must contain at least one branch.',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'User must be assigned to at least one branch.' })
  @ValidateNested({ each: true })
  @Type(() => UserBranchAssignmentDto)
  branches!: UserBranchAssignmentDto[];
}
