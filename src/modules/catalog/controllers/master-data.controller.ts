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
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiParam } from '@nestjs/swagger';
import { MasterDataService } from '../services/master-data.service.js';
import { CreateCategoryDto, UpdateCategoryDto } from '../dto/category.dto.js';
import { CreateBrandDto, UpdateBrandDto } from '../dto/brand.dto.js';
import { CreateSeasonDto, UpdateSeasonDto } from '../dto/season.dto.js';
import { CreateSizeDto, UpdateSizeDto } from '../dto/size.dto.js';
import { CreateColorDto, UpdateColorDto } from '../dto/color.dto.js';
import { CreateUnitDto, UpdateUnitDto } from '../dto/unit.dto.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { OptionalBranch } from '../../../common/decorators/optional-branch.decorator.js';
import { PERMISSIONS } from '../../../common/constants/permissions.constant.js';

@ApiTags('Catalog: Master Data')
@ApiBearerAuth()
@OptionalBranch()
@Controller('api/v1/catalog')
export class MasterDataController {
  constructor(private readonly masterDataService: MasterDataService) {}

  // ==========================================================================
  // CATEGORIES
  // ==========================================================================

  @Post('categories')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({ summary: 'Create category' })
  async createCategory(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCategoryDto) {
    return this.masterDataService.createCategory(user.businessId, dto);
  }

  @Get('categories')
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'List categories' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  async listCategories(
    @CurrentUser() user: AuthenticatedUser,
    @Query('search') search?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.masterDataService.listCategories(user.businessId, search, includeInactive === 'true');
  }

  @Get('categories/:id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Get category by ID' })
  async getCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.masterDataService.getCategory(user.businessId, id);
  }

  @Patch('categories/:id')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({ summary: 'Update category' })
  async updateCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.masterDataService.updateCategory(user.businessId, id, dto);
  }

  @Delete('categories/:id')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({ summary: 'Delete category (blocked if it has sub-categories or products)' })
  async deleteCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.masterDataService.deleteCategory(user.businessId, id);
  }

  // ==========================================================================
  // BRANDS
  // ==========================================================================

  @Post('brands')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.BRANDS_MANAGE)
  @ApiOperation({ summary: 'Create brand' })
  async createBrand(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBrandDto) {
    return this.masterDataService.createBrand(user.businessId, dto);
  }

  @Get('brands')
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'List brands' })
  @ApiQuery({ name: 'search', required: false })
  async listBrands(@CurrentUser() user: AuthenticatedUser, @Query('search') search?: string) {
    return this.masterDataService.listBrands(user.businessId, search);
  }

  @Get('brands/:id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Get brand by ID' })
  async getBrand(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.masterDataService.getBrand(user.businessId, id);
  }

  @Patch('brands/:id')
  @RequirePermissions(PERMISSIONS.BRANDS_MANAGE)
  @ApiOperation({ summary: 'Update brand' })
  async updateBrand(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBrandDto,
  ) {
    return this.masterDataService.updateBrand(user.businessId, id, dto);
  }

  @Delete('brands/:id')
  @RequirePermissions(PERMISSIONS.BRANDS_MANAGE)
  @ApiOperation({ summary: 'Delete brand' })
  async deleteBrand(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.masterDataService.deleteBrand(user.businessId, id);
  }

  // ==========================================================================
  // SEASONS
  // ==========================================================================

  @Post('seasons')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  @ApiOperation({ summary: 'Create season / collection' })
  async createSeason(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSeasonDto) {
    return this.masterDataService.createSeason(user.businessId, dto);
  }

  @Get('seasons')
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'List seasons' })
  @ApiQuery({ name: 'search', required: false })
  async listSeasons(@CurrentUser() user: AuthenticatedUser, @Query('search') search?: string) {
    return this.masterDataService.listSeasons(user.businessId, search);
  }

  @Get('seasons/:id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Get season by ID' })
  async getSeason(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.masterDataService.getSeason(user.businessId, id);
  }

  @Patch('seasons/:id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  @ApiOperation({ summary: 'Update season' })
  async updateSeason(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSeasonDto,
  ) {
    return this.masterDataService.updateSeason(user.businessId, id, dto);
  }

  @Delete('seasons/:id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  @ApiOperation({ summary: 'Delete season' })
  async deleteSeason(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.masterDataService.deleteSeason(user.businessId, id);
  }

  // ==========================================================================
  // SIZES (Includes system rows)
  // ==========================================================================

  @Post('sizes')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  @ApiOperation({ summary: 'Create size' })
  async createSize(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSizeDto) {
    return this.masterDataService.createSize(user.businessId, dto);
  }

  @Get('sizes')
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'List sizes (system and tenant)' })
  async listSizes(@CurrentUser() user: AuthenticatedUser) {
    return this.masterDataService.listSizes(user.businessId);
  }

  @Get('sizes/:id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Get size by ID' })
  async getSize(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.masterDataService.getSize(user.businessId, id);
  }

  @Patch('sizes/:id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  @ApiOperation({ summary: 'Update size (system rows cannot be modified)' })
  async updateSize(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSizeDto,
  ) {
    return this.masterDataService.updateSize(user.businessId, id, dto);
  }

  @Delete('sizes/:id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  @ApiOperation({ summary: 'Delete size (system rows cannot be deleted)' })
  async deleteSize(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.masterDataService.deleteSize(user.businessId, id);
  }

  // ==========================================================================
  // COLORS (Includes system rows)
  // ==========================================================================

  @Post('colors')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  @ApiOperation({ summary: 'Create color' })
  async createColor(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateColorDto) {
    return this.masterDataService.createColor(user.businessId, dto);
  }

  @Get('colors')
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'List colors (system and tenant)' })
  async listColors(@CurrentUser() user: AuthenticatedUser) {
    return this.masterDataService.listColors(user.businessId);
  }

  @Get('colors/:id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Get color by ID' })
  async getColor(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.masterDataService.getColor(user.businessId, id);
  }

  @Patch('colors/:id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  @ApiOperation({ summary: 'Update color (system rows cannot be modified)' })
  async updateColor(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateColorDto,
  ) {
    return this.masterDataService.updateColor(user.businessId, id, dto);
  }

  @Delete('colors/:id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  @ApiOperation({ summary: 'Delete color (system rows cannot be deleted)' })
  async deleteColor(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.masterDataService.deleteColor(user.businessId, id);
  }

  // ==========================================================================
  // UNITS (Includes system rows)
  // ==========================================================================

  @Post('units')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  @ApiOperation({ summary: 'Create unit' })
  async createUnit(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateUnitDto) {
    return this.masterDataService.createUnit(user.businessId, dto);
  }

  @Get('units')
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'List units (system and tenant)' })
  async listUnits(@CurrentUser() user: AuthenticatedUser) {
    return this.masterDataService.listUnits(user.businessId);
  }

  @Get('units/:id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({ summary: 'Get unit by ID' })
  async getUnit(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.masterDataService.getUnit(user.businessId, id);
  }

  @Patch('units/:id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  @ApiOperation({ summary: 'Update unit (system rows cannot be modified)' })
  async updateUnit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUnitDto,
  ) {
    return this.masterDataService.updateUnit(user.businessId, id, dto);
  }

  @Delete('units/:id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  @ApiOperation({ summary: 'Delete unit (system rows cannot be deleted)' })
  async deleteUnit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.masterDataService.deleteUnit(user.businessId, id);
  }
}
