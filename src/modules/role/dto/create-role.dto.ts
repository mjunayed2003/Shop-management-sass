import { IsString, IsNotEmpty, IsOptional, IsArray, ArrayMinSize } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRoleDto {
  @ApiProperty({ example: 'Inventory Manager', description: 'Human-readable role name' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ example: 'INVENTORY_MANAGER', description: 'Unique role code within business' })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ example: 'Manages warehouse and stock adjustments' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    example: ['inventory:read', 'inventory:adjust'],
    description: 'Array of permission codes or permission UUIDs to assign to this role',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'A role must have at least one permission assigned.' })
  permissionCodes!: string[];
}
