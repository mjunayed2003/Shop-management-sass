import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiHeader, ApiParam } from '@nestjs/swagger';
import { StocktakeService } from '../services/stocktake.service.js';
import {
  StartStocktakeDto,
  RecordStocktakeCountsDto,
  CompleteStocktakeDto,
  StocktakeQueryDto,
} from '../dto/stocktake.dto.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { CurrentBranch } from '../../../common/decorators/current-branch.decorator.js';
import type { BranchContext } from '../../../common/decorators/current-branch.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '../../../common/constants/permissions.constant.js';

@ApiTags('Inventory: Stocktake')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-branch-id',
  required: true,
  description: 'Branch context UUID for stocktake operations',
})
@Controller('api/v1/inventory/stocktakes')
export class StocktakeController {
  constructor(private readonly stocktakeService: StocktakeService) {}

  @Post('start')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.INVENTORY_STOCKTAKE)
  @ApiOperation({
    summary:
      'Start Stocktake (Enforces only ONE active stocktake per branch; takes system_qty snapshot)',
  })
  @ApiResponse({ status: 201, description: 'Stocktake started' })
  async startStocktake(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Body() dto: StartStocktakeDto,
  ) {
    return this.stocktakeService.startStocktake(
      user.businessId,
      branchContext.branchId,
      user.id,
      dto,
    );
  }

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'List Stocktakes for current branch' })
  async listStocktakes(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Query() query: StocktakeQueryDto,
  ) {
    return this.stocktakeService.listStocktakes(
      user.businessId,
      branchContext.branchId,
      query,
    );
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'Get Stocktake detail and counted discrepancies' })
  @ApiParam({ name: 'id', description: 'Stocktake UUID' })
  async getStocktakeById(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.stocktakeService.getStocktakeById(
      user.businessId,
      branchContext.branchId,
      id,
    );
  }

  @Post(':id/counts')
  @RequirePermissions(PERMISSIONS.INVENTORY_STOCKTAKE)
  @ApiOperation({ summary: 'Record physical counts for stocktake items' })
  @ApiParam({ name: 'id', description: 'Stocktake UUID' })
  async recordCounts(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordStocktakeCountsDto,
  ) {
    return this.stocktakeService.recordCounts(
      user.businessId,
      branchContext.branchId,
      id,
      dto,
    );
  }

  @Post(':id/complete')
  @RequirePermissions(PERMISSIONS.INVENTORY_STOCKTAKE)
  @ApiOperation({
    summary: 'Complete Stocktake (Optionally generates DRAFT StockAdjustment from discrepancies)',
  })
  @ApiParam({ name: 'id', description: 'Stocktake UUID' })
  async completeStocktake(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteStocktakeDto,
  ) {
    return this.stocktakeService.completeStocktake(
      user.businessId,
      branchContext.branchId,
      user.id,
      id,
      dto,
    );
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.INVENTORY_STOCKTAKE)
  @ApiOperation({ summary: 'Cancel active Stocktake' })
  @ApiParam({ name: 'id', description: 'Stocktake UUID' })
  async cancelStocktake(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.stocktakeService.cancelStocktake(
      user.businessId,
      branchContext.branchId,
      id,
    );
  }
}
