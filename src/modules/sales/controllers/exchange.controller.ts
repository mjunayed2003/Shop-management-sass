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
import { ExchangeService } from '../services/exchange.service.js';
import { CreateExchangeDto, ExchangeQueryDto } from '../dto/exchange.dto.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { CurrentBranch } from '../../../common/decorators/current-branch.decorator.js';
import type { BranchContext } from '../../../common/decorators/current-branch.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { PrismaService } from '../../../prisma/prisma.service.js';

@ApiTags('Sales Exchanges')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-branch-id',
  required: true,
  description: 'Branch context UUID',
})
@Controller('api/v1/sales/exchanges')
export class ExchangeController {
  constructor(
    private readonly exchangeService: ExchangeService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('exchange.create')
  @ApiOperation({
    summary: 'Process an exchange transaction (return + new sale) in ONE atomic transaction',
  })
  @ApiResponse({ status: 201, description: 'Exchange processed successfully' })
  async createExchange(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Body() dto: CreateExchangeDto,
  ) {
    const userRole = await this.resolveUserRole(user);
    return this.exchangeService.createExchange(
      user.businessId,
      branchContext.branchId,
      user.id,
      dto,
      userRole,
    );
  }

  @Get()
  @RequirePermissions('sales:read')
  @ApiOperation({ summary: 'List branch exchanges with pagination' })
  async getExchangeList(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Query() query: ExchangeQueryDto,
  ) {
    return this.exchangeService.getExchangeList(
      user.businessId,
      branchContext.branchId,
      query,
      branchContext.isAllBranchAdmin,
    );
  }

  @Get(':id')
  @RequirePermissions('sales:read')
  @ApiOperation({ summary: 'Get full exchange details by ID' })
  @ApiParam({ name: 'id', description: 'Exchange UUID' })
  async getExchangeDetail(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id') exchangeId: string,
  ) {
    return this.exchangeService.getExchangeDetail(
      user.businessId,
      branchContext.branchId,
      exchangeId,
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
