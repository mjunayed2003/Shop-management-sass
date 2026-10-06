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
import { SupplierPaymentService } from '../services/supplier-payment.service.js';
import {
  CreateSupplierPaymentDto,
  SupplierPaymentQueryDto,
} from '../dto/supplier-payment.dto.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { CurrentBranch } from '../../../common/decorators/current-branch.decorator.js';
import type { BranchContext } from '../../../common/decorators/current-branch.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '../../../common/constants/permissions.constant.js';

@ApiTags('Inventory: Supplier Payments')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-branch-id',
  required: true,
  description: 'Branch context UUID for supplier payment management',
})
@Controller('api/v1/inventory/supplier-payments')
export class SupplierPaymentController {
  constructor(private readonly paymentService: SupplierPaymentService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.PURCHASES_CREATE)
  @ApiOperation({
    summary: 'Pay Supplier (Against specific purchase or general advance; updates purchase due and supplier balance)',
  })
  @ApiResponse({ status: 201, description: 'Supplier payment recorded successfully' })
  async createPayment(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Body() dto: CreateSupplierPaymentDto,
  ) {
    return this.paymentService.createPayment(
      user.businessId,
      branchContext.branchId,
      user.id,
      dto,
    );
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PURCHASES_READ)
  @ApiOperation({ summary: 'List Supplier Payments for current branch' })
  async listPayments(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Query() query: SupplierPaymentQueryDto,
  ) {
    return this.paymentService.listPayments(
      user.businessId,
      branchContext.branchId,
      query,
    );
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PURCHASES_READ)
  @ApiOperation({ summary: 'Get Supplier Payment detail' })
  @ApiParam({ name: 'id', description: 'Payment UUID' })
  async getPaymentById(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.paymentService.getPaymentById(
      user.businessId,
      branchContext.branchId,
      id,
    );
  }
}
