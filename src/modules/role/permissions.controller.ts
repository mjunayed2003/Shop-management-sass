import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { RoleService } from './role.service.js';
import { OptionalBranch } from '../../common/decorators/optional-branch.decorator.js';

@ApiTags('Permissions')
@ApiBearerAuth()
@OptionalBranch()
@Controller('api/v1/permissions')
export class PermissionsController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  @ApiOperation({ summary: 'List all system permissions grouped by module' })
  @ApiResponse({ status: 200, description: 'All system permissions grouped by functional module' })
  async listPermissions() {
    return this.roleService.listPermissionsGrouped();
  }
}
