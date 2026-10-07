import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
  ApiParam,
} from '@nestjs/swagger';
import { SalesReturnService } from '../services/sales-return.service.js';
import {
  CreateSalesReturnDto,
  SalesReturnQueryDto,
} from '../dto/sales-return.dto.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { CurrentBranch } from '../../../common/decorators/current-branch.decorator.js';
import type { BranchContext } from '../../../common/decorators/current-branch.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { PrismaService } from '../../../prisma/prisma.service.js';

@ApiTags('Sales Returns')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-branch-id',
  required: true,
  description: 'Branch context UUID',
})
@Controller('api/v1/sales/returns')
export class SalesReturnController {
  constructor(
    private readonly salesReturnService: SalesReturnService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('return.create')
  @ApiOperation({
    summary: 'Process a sales return against an invoice in ONE atomic transaction',
  })
  @ApiResponse({ status: 201, description: 'Sales return created successfully' })
  async createReturn(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Body() dto: CreateSalesReturnDto,
  ) {
    const userRole = await this.resolveUserRole(user);
    return this.salesReturnService.createReturn(
      user.businessId,
      branchContext.branchId,
      user.id,
      dto,
      userRole,
    );
  }

  @Get()
  @RequirePermissions('sales:read')
  @ApiOperation({ summary: 'List branch sales returns with pagination' })
  async getReturnList(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Query() query: SalesReturnQueryDto,
  ) {
    return this.salesReturnService.getReturnList(
      user.businessId,
      branchContext.branchId,
      query,
      branchContext.isAllBranchAdmin,
    );
  }

  @Get(':id')
  @RequirePermissions('sales:read')
  @ApiOperation({ summary: 'Get sales return details by ID' })
  @ApiParam({ name: 'id', description: 'SalesReturn UUID' })
  async getReturnDetail(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id') returnId: string,
  ) {
    return this.salesReturnService.getReturnDetail(
      user.businessId,
      branchContext.branchId,
      returnId,
      branchContext.isAllBranchAdmin,
    );
  }

  @Get(':id/slip')
  @RequirePermissions('sales:read')
  @ApiOperation({ summary: 'Get printable return slip receipt data' })
  @ApiParam({ name: 'id', description: 'SalesReturn UUID' })
  async getReturnSlip(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id') returnId: string,
  ) {
    return this.salesReturnService.getReturnSlip(
      user.businessId,
      branchContext.branchId,
      returnId,
      branchContext.isAllBranchAdmin,
    );
  }

  private async resolveUserRole(user: AuthenticatedUser) {
    if (user.isOwner) {
      return {
        code: 'OWNER',
        name: 'Business Owner',
        permissions: ['*'],
      };
    }

    if (user.roleId) {
      const role = await this.prisma.role.findUnique({
        where: { id: user.roleId },
        include: { role_permissions: { include: { permission: true } } },
      });

      if (role) {
        return {
          code: role.name,
          name: role.name,
          permissions: role.role_permissions.map((rp) => rp.permission.code),
        };
      }
    }

    return undefined;
  }
}
