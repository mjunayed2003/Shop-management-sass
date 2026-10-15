import { IsString, IsOptional, IsArray, ArrayMinSize } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateRoleDto {
  @ApiPropertyOptional({ example: 'Inventory Lead' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'Updated description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    example: ['inventory:read', 'inventory:adjust', 'inventory:transfer'],
    description: 'Updated list of permission codes or UUIDs',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'A role must have at least one permission assigned.' })
  @IsOptional()
  permissionCodes?: string[];
}
