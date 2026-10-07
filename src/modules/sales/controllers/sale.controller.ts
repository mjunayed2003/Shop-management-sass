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
import { SaleService } from '../services/sale.service.js';
import { PricingService } from '../services/pricing.service.js';
import { CalculateSaleDto } from '../dto/calculate-sale.dto.js';
import { CreateSaleDto } from '../dto/create-sale.dto.js';
import { VoidSaleDto } from '../dto/void-sale.dto.js';
import {
  SaleQueryDto,
  DailySalesSummaryQueryDto,
  SalesReportQueryDto,
} from '../dto/sale-query.dto.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { CurrentBranch } from '../../../common/decorators/current-branch.decorator.js';
import type { BranchContext } from '../../../common/decorators/current-branch.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { PrismaService } from '../../../prisma/prisma.service.js';

@ApiTags('Sales & POS')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-branch-id',
  required: true,
  description: 'Branch context UUID for POS transactions',
})
@Controller('api/v1/sales')
export class SaleController {
  constructor(
    private readonly saleService: SaleService,
    private readonly pricingService: PricingService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('calculate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('sale.read', 'sales:read', 'pos:access')
  @ApiOperation({
    summary: 'Calculate cart totals, discounts, coupon, tax & round-off without DB mutations',
  })
  async calculateCart(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Body() dto: CalculateSaleDto,
  ) {
    const userRole = await this.resolveUserRole(user);
    return this.pricingService.calculateCart(
      user.businessId,
      branchContext.branchId,
      dto,
      userRole,
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('sale.create', 'sales:create', 'pos:access')
  @ApiOperation({
    summary: 'Create POS Sale in ONE atomic transaction with stock WAC, payments, auto-transfer, and loyalty',
  })
  @ApiResponse({ status: 201, description: 'Sale invoice generated successfully' })
  async createSale(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Body() dto: CreateSaleDto,
  ) {
    const userRole = await this.resolveUserRole(user);
    return this.saleService.createSale(
      user.businessId,
      branchContext.branchId,
      user.id,
      dto,
      userRole,
    );
  }

  @Post(':id/void')
  @RequirePermissions('sale.void', 'sales:void')
  @ApiOperation({
    summary: 'Void an invoice in ONE transaction: reverses stock movements, customer due, and payments',
  })
  @ApiParam({ name: 'id', description: 'Sale UUID' })
  async voidSale(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id') saleId: string,
    @Body() dto: VoidSaleDto,
  ) {
    return this.saleService.voidSale(
      user.businessId,
      branchContext.branchId,
      user.id,
      saleId,
      dto,
    );
  }

  @Get('reports/daily-summary')
  @RequirePermissions('sale.read', 'sales:read')
  @ApiOperation({ summary: 'Daily sales summary grouped by payment tender methods' })
  async getDailySalesSummary(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Query() query: DailySalesSummaryQueryDto,
  ) {
    return this.saleService.getDailySalesSummary(
      user.businessId,
      branchContext.branchId,
      query,
      branchContext.isAllBranchAdmin,
    );
  }

  @Get('reports/by-group')
  @RequirePermissions('sale.read', 'sales:read')
  @ApiOperation({ summary: 'Sales report aggregated by product, brand, or category' })
  async getSalesReportByGroup(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Query() query: SalesReportQueryDto,
    @Query('groupBy') groupBy?: 'product' | 'brand' | 'category',
  ) {
    return this.saleService.getSalesReportByGroup(
      user.businessId,
      branchContext.branchId,
      query,
      groupBy || 'product',
      branchContext.isAllBranchAdmin,
    );
  }

  @Get()
  @RequirePermissions('sale.read', 'sales:read')
  @ApiOperation({ summary: 'List branch sales with filters and pagination' })
  async getSaleList(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Query() query: SaleQueryDto,
  ) {
    return this.saleService.getSaleList(
      user.businessId,
      branchContext.branchId,
      query,
      branchContext.isAllBranchAdmin,
    );
  }

  @Get(':id')
  @RequirePermissions('sale.read', 'sales:read')
  @ApiOperation({ summary: 'Get full sale detail by ID or invoice number' })
  @ApiParam({ name: 'id', description: 'Sale UUID or Invoice Number' })
  async getSaleDetail(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id') identifier: string,
  ) {
    return this.saleService.getSaleDetail(
      user.businessId,
      branchContext.branchId,
      identifier,
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
