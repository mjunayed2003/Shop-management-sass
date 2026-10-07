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
import { RegisterSessionService } from '../services/register-session.service.js';
import {
  OpenRegisterSessionDto,
  CreateCashMovementDto,
  CloseRegisterSessionDto,
  CashBookQueryDto,
} from '../dto/register-session.dto.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { CurrentBranch } from '../../../common/decorators/current-branch.decorator.js';
import type { BranchContext } from '../../../common/decorators/current-branch.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { PrismaService } from '../../../prisma/prisma.service.js';

@ApiTags('Sales: Register Sessions')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-branch-id',
  required: true,
  description: 'Branch context UUID for register sessions',
})
@Controller('api/v1/sales/register-sessions')
export class RegisterSessionController {
  constructor(
    private readonly registerSessionService: RegisterSessionService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('open')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('register.open_close', 'cash_register:open_close', 'pos:access')
  @ApiOperation({
    summary: 'Open cash register session for current user in current branch',
  })
  @ApiResponse({ status: 201, description: 'Register session opened successfully' })
  async openSession(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Body() dto: OpenRegisterSessionDto,
  ) {
    return this.registerSessionService.openSession(
      user.businessId,
      branchContext.branchId,
      user.id,
      dto,
    );
  }

  @Get('current')
  @RequirePermissions('register.view', 'cash_register:view', 'pos:access')
  @ApiOperation({
    summary: 'Get current active register session for user in current branch',
  })
  async getCurrentSession(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
  ) {
    return this.registerSessionService.getCurrentSession(
      user.businessId,
      branchContext.branchId,
      user.id,
    );
  }

  @Post('cash-movements')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('cash.move')
  @ApiOperation({
    summary: 'Record manual drawer cash movement (PAY_IN or PAY_OUT) in current active shift',
  })
  @ApiResponse({ status: 201, description: 'Cash movement recorded' })
  async createCashMovement(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Body() dto: CreateCashMovementDto,
  ) {
    return this.registerSessionService.createCashMovement(
      user.businessId,
      branchContext.branchId,
      user.id,
      dto,
    );
  }

  @Get('cash-movements')
  @RequirePermissions('cash_register:view')
  @ApiOperation({ summary: 'List cash movements for active branch or session' })
  async getCashMovements(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Query('sessionId') sessionId?: string,
  ) {
    return this.registerSessionService.getCashMovements(
      user.businessId,
      branchContext.branchId,
      sessionId,
      branchContext.isAllBranchAdmin,
    );
  }

  @Get('summary')
  @RequirePermissions('cash_register:view', 'register.close')
  @ApiOperation({
    summary: 'Get live X Report summary for active user session (no side-effects)',
  })
  async getActiveSessionSummary(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
  ) {
    return this.registerSessionService.getSessionSummary(
      user.businessId,
      branchContext.branchId,
      user.id,
      undefined,
      branchContext.isAllBranchAdmin,
    );
  }

  @Get(':id/summary')
  @RequirePermissions('cash_register:view', 'register.close')
  @ApiOperation({ summary: 'Get live X Report summary for specific session ID' })
  @ApiParam({ name: 'id', description: 'RegisterSession UUID' })
  async getSessionSummaryById(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id') sessionId: string,
  ) {
    return this.registerSessionService.getSessionSummary(
      user.businessId,
      branchContext.branchId,
      user.id,
      sessionId,
      branchContext.isAllBranchAdmin,
    );
  }

  @Post('close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('register.close')
  @ApiOperation({
    summary: 'Close register session (Z Report) with closing balance, discrepancy check & alerts',
  })
  async closeSession(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Body() dto: CloseRegisterSessionDto,
  ) {
    const userRole = await this.resolveUserRole(user);
    return this.registerSessionService.closeSession(
      user.businessId,
      branchContext.branchId,
      user.id,
      dto,
      userRole,
    );
  }

  @Get('cash-book')
  @RequirePermissions('cash_register:view', 'report.view')
  @ApiOperation({
    summary: 'Branch daily cash book: all closed/open sessions for a date with expected, counted, discrepancy',
  })
  async getDailyCashBook(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Query() query: CashBookQueryDto,
  ) {
    return this.registerSessionService.getDailyCashBook(
      user.businessId,
      branchContext.branchId,
      query,
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
