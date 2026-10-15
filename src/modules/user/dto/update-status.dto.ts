import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateUserStatusDto {
  @ApiProperty({ example: false, description: 'True to activate, false to deactivate' })
  @IsBoolean()
  isActive!: boolean;
}
