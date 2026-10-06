import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  ForbiddenException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { StockService } from '../services/stock.service.js';
import {
  CurrentStockQueryDto,
  StockMovementQueryDto,
  OpeningStockDto,
} from '../dto/stock-query.dto.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { CurrentBranch } from '../../../common/decorators/current-branch.decorator.js';
import type { BranchContext } from '../../../common/decorators/current-branch.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '../../../common/constants/permissions.constant.js';

@ApiTags('Inventory: Stock & Reports')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-branch-id',
  required: true,
  description: 'Branch context UUID for stock balancing and ledger operations',
})
@Controller('api/v1/inventory/stock')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({
    summary:
      'Current stock list for the branch (with filters: brand, category, season, gender, low-stock only, zero-stock only, search, pagination)',
  })
  async listCurrentStock(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Query() query: CurrentStockQueryDto,
  ) {
    return this.stockService.listCurrentStock(
      user.businessId,
      branchContext.branchId,
      query,
    );
  }

  @Get('all-branches-summary')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({
    summary:
      'All-branches stock summary (Admins only; per variant per branch, plus group-by brand / category with totals)',
  })
  async getAllBranchesSummary(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
  ) {
    if (!branchContext.isAllBranchAdmin && !user.isOwner) {
      throw new ForbiddenException('Only multi-branch admins or business owners can access the all-branches stock summary.');
    }
    return this.stockService.getAllBranchesSummary(user.businessId);
  }

  @Get('movements')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({
    summary: 'Stock movement history per variant (filter by date, movement_type, reference_type, pagination)',
  })
  async getMovementsHistory(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Query() query: StockMovementQueryDto,
  ) {
    return this.stockService.getMovementsHistory(
      user.businessId,
      branchContext.branchId,
      query,
    );
  }

  @Get('low-stock-report')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'Low-stock report using variant reorder level' })
  async getLowStockReport(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
  ) {
    return this.stockService.getLowStockReport(
      user.businessId,
      branchContext.branchId,
    );
  }

  @Get('valuation')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'Stock valuation report per branch (total cost value, category & brand breakdown)' })
  async getStockValuation(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
  ) {
    return this.stockService.getStockValuation(
      user.businessId,
      branchContext.branchId,
    );
  }

  @Post('opening')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @ApiOperation({
    summary:
      'Enter opening stock for a variant in a branch (Allowed ONLY if no movements exist for that variant+branch yet)',
  })
  @ApiResponse({ status: 201, description: 'Opening stock applied' })
  async enterOpeningStock(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Body() dto: OpeningStockDto,
  ) {
    return this.stockService.enterOpeningStock(
      user.businessId,
      branchContext.branchId,
      user.id,
      dto,
    );
  }

  @Get('consistency-check')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({
    summary:
      'Consistency Tool: compares StockBalance.quantity with sum of StockMovement and ProductUnit counts (reports mismatches, does not auto-fix)',
  })
  async checkConsistency(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
  ) {
    if (!branchContext.isAllBranchAdmin && !user.isOwner) {
      throw new ForbiddenException('Only administrators can run the stock consistency verification tool.');
    }
    return this.stockService.checkConsistency(
      user.businessId,
      branchContext.isAllBranchAdmin ? undefined : branchContext.branchId,
    );
  }
}
