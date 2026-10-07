import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { CustomerService } from '../services/customer.service.js';
import {
  CreateCustomerDto,
  QuickCreateCustomerDto,
  UpdateCustomerDto,
  CustomerQueryDto,
  CustomerLedgerQueryDto,
} from '../dto/customer.dto.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { OptionalBranch } from '../../../common/decorators/optional-branch.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';

@ApiTags('Customers (Business-Wide)')
@ApiBearerAuth()
@OptionalBranch()
@Controller('api/v1/customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('customer.manage', 'customers:manage')
  @ApiOperation({ summary: 'Create new customer (Business-wide, normalized phone)' })
  @ApiResponse({ status: 201, description: 'Customer created' })
  async createCustomer(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCustomerDto,
  ) {
    return this.customerService.createCustomer(user.businessId, dto);
  }

  @Post('quick')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('customer.manage', 'customers:manage', 'pos:access')
  @ApiOperation({ summary: 'Quick-create customer from POS with name + phone only' })
  @ApiResponse({ status: 201, description: 'Customer quick-created' })
  async quickCreateCustomer(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: QuickCreateCustomerDto,
  ) {
    return this.customerService.quickCreateCustomer(user.businessId, dto);
  }

  @Get('lookup')
  @RequirePermissions('customer.read', 'customers:read', 'pos:access')
  @ApiOperation({ summary: 'Lookup customer by BD phone number (normalized format)' })
  async lookupByPhone(
    @CurrentUser() user: AuthenticatedUser,
    @Query('phone') phone: string,
  ) {
    return this.customerService.lookupByPhone(user.businessId, phone);
  }

  @Get('due-summary')
  @RequirePermissions('customer.read', 'customers:read')
  @ApiOperation({ summary: 'Customer due summary report per branch (read-only)' })
  async getDueSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.customerService.getCustomerDueSummaryByBranch(user.businessId);
  }

  @Get('ledger/:id')
  @RequirePermissions('customer.read', 'customers:read')
  @ApiOperation({ summary: 'Customer ledger: sales, returns, due collections, running due with branch info' })
  @ApiParam({ name: 'id', description: 'Customer UUID' })
  async getCustomerLedger(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CustomerLedgerQueryDto,
  ) {
    return this.customerService.getCustomerLedger(user.businessId, id, query);
  }

  @Get()
  @RequirePermissions('customer.read', 'customers:read')
  @ApiOperation({ summary: 'List and search customers by name/phone' })
  async listCustomers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CustomerQueryDto,
  ) {
    return this.customerService.listCustomers(user.businessId, query);
  }

  @Get(':id')
  @RequirePermissions('customer.read', 'customers:read')
  @ApiOperation({ summary: 'Get customer by ID' })
  @ApiParam({ name: 'id', description: 'Customer UUID' })
  async getCustomerById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customerService.getCustomerById(user.businessId, id);
  }

  @Put(':id')
  @RequirePermissions('customer.manage', 'customers:manage')
  @ApiOperation({ summary: 'Update customer details' })
  @ApiParam({ name: 'id', description: 'Customer UUID' })
  async updateCustomer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customerService.updateCustomer(user.businessId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('customer.manage', 'customers:manage')
  @ApiOperation({ summary: 'Soft delete customer' })
  @ApiParam({ name: 'id', description: 'Customer UUID' })
  async deleteCustomer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customerService.deleteCustomer(user.businessId, id);
  }
}
