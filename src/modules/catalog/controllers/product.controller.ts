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
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiHeader, ApiParam } from '@nestjs/swagger';
import { ProductService } from '../services/product.service.js';
import { CreateProductDto } from '../dto/create-product.dto.js';
import { UpdateProductDto } from '../dto/update-product.dto.js';
import { ProductQueryDto } from '../dto/product-query.dto.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { CurrentBranch } from '../../../common/decorators/current-branch.decorator.js';
import type { BranchContext } from '../../../common/decorators/current-branch.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '../../../common/constants/permissions.constant.js';

@ApiTags('Catalog: Products')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-branch-id',
  required: true,
  description: 'Current branch context UUID for stock balancing and catalog visibility',
})
@Controller('api/v1/catalog/products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.PRODUCTS_CREATE)
  @ApiOperation({
    summary: 'Create product with variants (Single Transaction)',
    description:
      'Creates a product with initial variants in one transaction. Automatically assigns the product to the current branch via ProductBranch, and allows admins to assign to multiple branches.',
  })
  @ApiResponse({ status: 201, description: 'Product and variants created successfully' })
  @ApiResponse({ status: 409, description: 'Duplicate product code, SKU, or barcode' })
  async createProduct(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Body() dto: CreateProductDto,
  ) {
    return this.productService.createProduct(
      user.businessId,
      branchContext.branchId,
      user.id,
      branchContext.isAllBranchAdmin,
      dto,
    );
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({
    summary: 'List products with current branch stock and filters',
    description:
      'Branch users only see products active in their branch. Admins/owners see all products and can filter with ?branchId=. Includes current branch stock balance from StockBalance.',
  })
  @ApiResponse({ status: 200, description: 'Paginated list of products' })
  async listProducts(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Query() query: ProductQueryDto,
  ) {
    return this.productService.listProducts(
      user.businessId,
      branchContext.branchId,
      branchContext.isAllBranchAdmin,
      query,
    );
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Get product detail with variants and active branch list' })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({ status: 200, description: 'Product details' })
  @ApiResponse({ status: 404, description: 'Product not found or not active in current branch' })
  async getProduct(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productService.getProduct(
      user.businessId,
      branchContext.branchId,
      branchContext.isAllBranchAdmin,
      id,
    );
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  @ApiOperation({ summary: 'Update product' })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({ status: 200, description: 'Product updated successfully' })
  async updateProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productService.updateProduct(user.businessId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_DELETE)
  @ApiOperation({ summary: 'Soft-delete product and its variants' })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({ status: 200, description: 'Product soft-deleted successfully' })
  async deleteProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productService.deleteProduct(user.businessId, id);
  }
}
