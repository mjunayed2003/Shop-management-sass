import {
  Controller,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiHeader } from '@nestjs/swagger';
import { VariantService } from '../services/variant.service.js';
import { CreateVariantDto, UpdateVariantDto, BulkGenerateVariantsDto } from '../dto/variant.dto.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { OptionalBranch } from '../../../common/decorators/optional-branch.decorator.js';
import { PERMISSIONS } from '../../../common/constants/permissions.constant.js';

@ApiTags('Catalog: Variants')
@ApiBearerAuth()
@OptionalBranch()
@Controller('api/v1/catalog/variants')
export class VariantController {
  constructor(private readonly variantService: VariantService) {}

  @Post('products/:productId')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  @ApiOperation({ summary: 'Add a new variant under a product' })
  @ApiParam({ name: 'productId', description: 'Product UUID' })
  @ApiResponse({ status: 201, description: 'Variant created' })
  @ApiResponse({ status: 409, description: 'Duplicate SKU or barcode' })
  async createVariant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: CreateVariantDto,
  ) {
    return this.variantService.createVariant(user.businessId, productId, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  @ApiOperation({ summary: 'Update variant details and prices' })
  @ApiParam({ name: 'id', description: 'Variant UUID' })
  @ApiResponse({ status: 200, description: 'Variant updated' })
  async updateVariant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.variantService.updateVariant(user.businessId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  @ApiOperation({ summary: 'Deactivate variant' })
  @ApiParam({ name: 'id', description: 'Variant UUID' })
  @ApiResponse({ status: 200, description: 'Variant deactivated' })
  async deactivateVariant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.variantService.deactivateVariant(user.businessId, id);
  }

  @Post('products/:productId/bulk')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  @ApiOperation({
    summary: 'Bulk generate variants (Cartesian product of Sizes x Colors)',
    description:
      'Given a product plus lists of sizes and colors, generates all combinations with auto-generated SKUs and barcodes in a single transaction.',
  })
  @ApiParam({ name: 'productId', description: 'Product UUID' })
  @ApiResponse({ status: 201, description: 'Variants generated successfully' })
  async bulkGenerateVariants(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: BulkGenerateVariantsDto,
  ) {
    return this.variantService.bulkGenerateVariants(user.businessId, productId, dto);
  }
}
