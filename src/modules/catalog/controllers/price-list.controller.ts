import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { PriceListService } from '../services/price-list.service.js';
import {
  CreatePriceListDto,
  UpdatePriceListDto,
  SetPriceListItemDto,
} from '../dto/price-list.dto.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { OptionalBranch } from '../../../common/decorators/optional-branch.decorator.js';
import { PERMISSIONS } from '../../../common/constants/permissions.constant.js';

@ApiTags('Catalog: Price Lists')
@ApiBearerAuth()
@OptionalBranch()
@Controller('api/v1/catalog/price-lists')
export class PriceListController {
  constructor(private readonly priceListService: PriceListService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  @ApiOperation({ summary: 'Create custom price list (Retail, Wholesale, Festive Offer)' })
  @ApiResponse({ status: 201, description: 'Price list created' })
  async createPriceList(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePriceListDto,
  ) {
    return this.priceListService.createPriceList(user.businessId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'List price lists' })
  @ApiResponse({ status: 200, description: 'List of price lists' })
  async listPriceLists(@CurrentUser() user: AuthenticatedUser) {
    return this.priceListService.listPriceLists(user.businessId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Get price list with item entries' })
  @ApiParam({ name: 'id', description: 'Price list UUID' })
  @ApiResponse({ status: 200, description: 'Price list details with items' })
  async getPriceList(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.priceListService.getPriceList(user.businessId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  @ApiOperation({ summary: 'Update price list settings' })
  @ApiParam({ name: 'id', description: 'Price list UUID' })
  @ApiResponse({ status: 200, description: 'Price list updated' })
  async updatePriceList(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePriceListDto,
  ) {
    return this.priceListService.updatePriceList(user.businessId, id, dto);
  }

  @Post(':id/items')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  @ApiOperation({ summary: 'Set or update price for a variant under this price list' })
  @ApiParam({ name: 'id', description: 'Price list UUID' })
  @ApiResponse({ status: 200, description: 'Price list item updated' })
  async setPriceListItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPriceListItemDto,
  ) {
    return this.priceListService.setPriceListItem(user.businessId, id, dto);
  }

  @Delete(':id/items/:variantId')
  @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  @ApiOperation({ summary: 'Remove variant price override from this price list' })
  @ApiParam({ name: 'id', description: 'Price list UUID' })
  @ApiParam({ name: 'variantId', description: 'Variant UUID' })
  @ApiResponse({ status: 200, description: 'Price list item removed' })
  async removePriceListItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
  ) {
    return this.priceListService.removePriceListItem(user.businessId, id, variantId);
  }
}
