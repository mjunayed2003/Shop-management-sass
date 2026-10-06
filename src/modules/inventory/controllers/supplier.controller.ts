import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { SupplierService } from '../services/supplier.service.js';
import {
  CreateSupplierDto,
  UpdateSupplierDto,
  SupplierQueryDto,
  SupplierLedgerQueryDto,
} from '../dto/supplier.dto.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { OptionalBranch } from '../../../common/decorators/optional-branch.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '../../../common/constants/permissions.constant.js';

@ApiTags('Inventory: Suppliers')
@ApiBearerAuth()
@OptionalBranch()
@Controller('api/v1/inventory/suppliers')
export class SupplierController {
  constructor(private readonly supplierService: SupplierService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.SUPPLIERS_MANAGE)
  @ApiOperation({ summary: 'Create supplier (Business-wide)' })
  @ApiResponse({ status: 201, description: 'Supplier created successfully' })
  async createSupplier(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSupplierDto,
  ) {
    return this.supplierService.createSupplier(user.businessId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PURCHASES_READ)
  @ApiOperation({ summary: 'List suppliers (Business-wide with search and pagination)' })
  async listSuppliers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SupplierQueryDto,
  ) {
    return this.supplierService.listSuppliers(user.businessId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PURCHASES_READ)
  @ApiOperation({ summary: 'Get supplier details' })
  @ApiParam({ name: 'id', description: 'Supplier UUID' })
  async getSupplierById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.supplierService.getSupplierById(user.businessId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.SUPPLIERS_MANAGE)
  @ApiOperation({ summary: 'Update supplier' })
  @ApiParam({ name: 'id', description: 'Supplier UUID' })
  async updateSupplier(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.supplierService.updateSupplier(user.businessId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.SUPPLIERS_MANAGE)
  @ApiOperation({ summary: 'Soft-delete supplier' })
  @ApiParam({ name: 'id', description: 'Supplier UUID' })
  async deleteSupplier(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.supplierService.deleteSupplier(user.businessId, id);
  }

  @Get(':id/ledger')
  @RequirePermissions(PERMISSIONS.PURCHASES_READ)
  @ApiOperation({ summary: 'Supplier Ledger (Purchases, returns, payments, running balance)' })
  @ApiParam({ name: 'id', description: 'Supplier UUID' })
  async getSupplierLedger(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: SupplierLedgerQueryDto,
  ) {
    return this.supplierService.getSupplierLedger(user.businessId, id, query);
  }
}
