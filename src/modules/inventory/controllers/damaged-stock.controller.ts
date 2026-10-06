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
import { DamagedStockService } from '../services/damaged-stock.service.js';
import {
  ReportDamagedStockDto,
  DamagedStockQueryDto,
} from '../dto/damaged-stock.dto.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { CurrentBranch } from '../../../common/decorators/current-branch.decorator.js';
import type { BranchContext } from '../../../common/decorators/current-branch.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '../../../common/constants/permissions.constant.js';

@ApiTags('Inventory: Damaged Stock')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-branch-id',
  required: true,
  description: 'Branch context UUID for damaged stock management',
})
@Controller('api/v1/inventory/damaged-stock')
export class DamagedStockController {
  constructor(private readonly damageService: DamagedStockService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @ApiOperation({ summary: 'Report Damaged Stock (PENDING status; snapshots current WAC)' })
  @ApiResponse({ status: 201, description: 'Damaged stock reported' })
  async reportDamagedStock(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Body() dto: ReportDamagedStockDto,
  ) {
    return this.damageService.reportDamagedStock(
      user.businessId,
      branchContext.branchId,
      user.id,
      dto,
    );
  }

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'List Damaged Stock reports for current branch' })
  async listDamagedStock(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Query() query: DamagedStockQueryDto,
  ) {
    return this.damageService.listDamagedStock(
      user.businessId,
      branchContext.branchId,
      query,
    );
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.STOCK_APPROVE)
  @ApiOperation({ summary: 'Approve Damaged Stock (PENDING -> APPROVED)' })
  @ApiParam({ name: 'id', description: 'Damaged Stock UUID' })
  async approveDamagedStock(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.damageService.approveDamagedStock(
      user.businessId,
      branchContext.branchId,
      user.id,
      id,
    );
  }

  @Post(':id/write-off')
  @RequirePermissions(PERMISSIONS.STOCK_APPROVE)
  @ApiOperation({
    summary: 'Write-off Damaged Stock (APPROVED -> WRITTEN_OFF; executes DAMAGE stock-out movement at exact current WAC)',
  })
  @ApiParam({ name: 'id', description: 'Damaged Stock UUID' })
  async writeOffDamagedStock(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.damageService.writeOffDamagedStock(
      user.businessId,
      branchContext.branchId,
      user.id,
      id,
    );
  }
}
