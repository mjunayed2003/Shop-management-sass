import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { RoleService } from './role.service.js';
import { CreateRoleDto } from './dto/create-role.dto.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { OptionalBranch } from '../../common/decorators/optional-branch.decorator.js';
import { PERMISSIONS } from '../../common/constants/permissions.constant.js';

@ApiTags('Roles')
@ApiBearerAuth()
@OptionalBranch()
@Controller('api/v1/roles')
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  @ApiOperation({ summary: 'List all system and business roles with permissions and user count' })
  @ApiResponse({ status: 200, description: 'List of roles' })
  async listRoles(@CurrentUser() user: AuthenticatedUser) {
    return this.roleService.listRoles(user.businessId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  @ApiOperation({ summary: 'Create custom business role with assigned permissions' })
  @ApiResponse({ status: 201, description: 'Role created successfully' })
  async createRole(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRoleDto,
  ) {
    return this.roleService.createRole(user.businessId, user.id, dto);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  @ApiOperation({ summary: 'Get role details and permissions' })
  @ApiParam({ name: 'id', description: 'Role UUID' })
  @ApiResponse({ status: 200, description: 'Role details' })
  async getRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) roleId: string,
  ) {
    return this.roleService.getRole(user.businessId, roleId);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  @ApiOperation({ summary: 'Update role details and assigned permissions' })
  @ApiParam({ name: 'id', description: 'Role UUID' })
  @ApiResponse({ status: 200, description: 'Role updated successfully' })
  async updateRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) roleId: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.roleService.updateRole(user.businessId, user.id, roleId, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  @ApiOperation({ summary: 'Delete custom role if not assigned to any users' })
  @ApiParam({ name: 'id', description: 'Role UUID' })
  @ApiResponse({ status: 200, description: 'Role deleted successfully' })
  async deleteRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) roleId: string,
  ) {
    return this.roleService.deleteRole(user.businessId, user.id, roleId);
  }
}
