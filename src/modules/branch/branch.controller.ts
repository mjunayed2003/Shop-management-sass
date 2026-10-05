import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { BranchService } from './branch.service.js';
import { CreateBranchDto } from './dto/create-branch.dto.js';
import { UpdateBranchDto } from './dto/update-branch.dto.js';
import { AssignUserBranchDto } from './dto/assign-user-branch.dto.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { OptionalBranch } from '../../common/decorators/optional-branch.decorator.js';
import { PERMISSIONS } from '../../common/constants/permissions.constant.js';

@ApiTags('Branches')
@ApiBearerAuth()
@OptionalBranch()
@Controller('api/v1/branches')
export class BranchController {
  constructor(private readonly branchService: BranchService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.BRANCHES_CREATE)
  @ApiOperation({
    summary: 'Create a new branch',
    description:
      'Creates a new branch under the authenticated business. Enforces PlanLimit.max_branches and auto-generates invoice sequences and a cash register.',
  })
  @ApiResponse({ status: 201, description: 'Branch created successfully' })
  @ApiResponse({ status: 403, description: 'Plan limit reached' })
  @ApiResponse({ status: 409, description: 'Branch code already in use' })
  async createBranch(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBranchDto,
  ) {
    return this.branchService.createBranch(user.businessId, user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List accessible branches',
    description:
      'Returns all active branches for business owner, or assigned branches for staff users.',
  })
  @ApiQuery({
    name: 'includeInactive',
    required: false,
    type: Boolean,
    description: 'Whether to include deactivated branches',
  })
  @ApiResponse({ status: 200, description: 'List of branches' })
  async listBranches(
    @CurrentUser() user: AuthenticatedUser,
    @Query('includeInactive') includeInactive?: string,
  ) {
    const shouldInclude = includeInactive === 'true' || includeInactive === '1';
    return this.branchService.listBranches(
      user.businessId,
      user.id,
      user.isOwner,
      shouldInclude,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single branch by ID' })
  @ApiParam({ name: 'id', description: 'Branch UUID' })
  @ApiResponse({ status: 200, description: 'Branch details with cash registers and assigned staff' })
  @ApiResponse({ status: 404, description: 'Branch not found' })
  async getBranch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) branchId: string,
  ) {
    return this.branchService.getBranch(
      user.businessId,
      branchId,
      user.id,
      user.isOwner,
    );
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.BRANCHES_UPDATE)
  @ApiOperation({ summary: 'Update branch details' })
  @ApiParam({ name: 'id', description: 'Branch UUID' })
  @ApiResponse({ status: 200, description: 'Branch updated successfully' })
  @ApiResponse({ status: 400, description: 'Cannot deactivate the last active branch' })
  async updateBranch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) branchId: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.branchService.updateBranch(user.businessId, branchId, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.BRANCHES_DELETE)
  @ApiOperation({
    summary: 'Deactivate branch',
    description:
      'Deactivates a branch. Enforces critical business rule: The last active branch of a business can never be deleted or deactivated.',
  })
  @ApiParam({ name: 'id', description: 'Branch UUID' })
  @ApiResponse({ status: 200, description: 'Branch deactivated successfully' })
  @ApiResponse({ status: 400, description: 'Cannot deactivate the last active branch' })
  async deactivateBranch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) branchId: string,
  ) {
    return this.branchService.deactivateBranch(user.businessId, branchId);
  }

  @Post(':id/users')
  @RequirePermissions(PERMISSIONS.BRANCHES_ASSIGN_USER)
  @ApiOperation({ summary: 'Assign staff user to branch' })
  @ApiParam({ name: 'id', description: 'Branch UUID' })
  @ApiResponse({ status: 200, description: 'User assigned to branch successfully' })
  async assignUser(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) branchId: string,
    @Body() dto: AssignUserBranchDto,
  ) {
    return this.branchService.assignUser(user.businessId, branchId, dto);
  }

  @Delete(':id/users/:userId')
  @RequirePermissions(PERMISSIONS.BRANCHES_ASSIGN_USER)
  @ApiOperation({ summary: 'Revoke staff user access from branch' })
  @ApiParam({ name: 'id', description: 'Branch UUID' })
  @ApiParam({ name: 'userId', description: 'User UUID to remove' })
  @ApiResponse({ status: 200, description: 'Access revoked successfully' })
  @ApiResponse({ status: 403, description: 'Cannot revoke owner access' })
  async removeUser(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) branchId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
  ) {
    return this.branchService.removeUser(user.businessId, branchId, targetUserId);
  }
}
