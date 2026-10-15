import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { UserService } from './user.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UpdateUserBranchesDto } from './dto/update-user-branches.dto.js';
import { ResetUserPasswordDto } from './dto/reset-password.dto.js';
import { UpdateUserStatusDto } from './dto/update-status.dto.js';
import { UserQueryDto } from './dto/user-query.dto.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { OptionalBranch } from '../../common/decorators/optional-branch.decorator.js';
import { PERMISSIONS } from '../../common/constants/permissions.constant.js';

@ApiTags('Users')
@ApiBearerAuth()
@OptionalBranch()
@Controller('api/v1/users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'List business users with role, branches, and pagination' })
  @ApiResponse({ status: 200, description: 'Paginated users list' })
  async listUsers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: UserQueryDto,
  ) {
    return this.userService.listUsers(user.businessId, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.USERS_CREATE)
  @ApiOperation({ summary: 'Create new user under business (enforces PlanLimit.max_users)' })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({ status: 403, description: 'User limit reached for current subscription plan' })
  async createUser(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateUserDto,
  ) {
    return this.userService.createUser(user.businessId, user.id, dto);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'Get single user details by ID' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User details' })
  async getUser(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) targetUserId: string,
  ) {
    return this.userService.getUser(user.businessId, targetUserId);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.USERS_UPDATE)
  @ApiOperation({ summary: 'Update user name, email, phone, or role' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User updated successfully' })
  async updateUser(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) targetUserId: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.userService.updateUser(user.businessId, user.id, targetUserId, dto);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.USERS_DELETE)
  @ApiOperation({ summary: 'Activate or deactivate a user account' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'Status updated' })
  async updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) targetUserId: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.userService.updateStatus(user.businessId, user.id, targetUserId, dto.isActive);
  }

  @Put(':id/branches')
  @RequirePermissions(PERMISSIONS.USERS_UPDATE)
  @ApiOperation({ summary: 'Update accessible branches and default branch for user' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'Branch access updated' })
  async updateBranches(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) targetUserId: string,
    @Body() dto: UpdateUserBranchesDto,
  ) {
    return this.userService.updateBranches(user.businessId, user.id, targetUserId, dto);
  }

  @Post(':id/reset-password')
  @RequirePermissions(PERMISSIONS.USERS_UPDATE)
  @ApiOperation({ summary: 'Admin resets user password' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'Password reset' })
  async resetPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) targetUserId: string,
    @Body() dto: ResetUserPasswordDto,
  ) {
    return this.userService.resetPassword(user.businessId, user.id, targetUserId, dto.newPassword);
  }
}
