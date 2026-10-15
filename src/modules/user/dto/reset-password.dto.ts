import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetUserPasswordDto {
  @ApiProperty({ example: 'NewSecret123!', minLength: 6, description: 'New password for the user' })
  @IsString()
  @MinLength(6)
  newPassword!: string;
}
