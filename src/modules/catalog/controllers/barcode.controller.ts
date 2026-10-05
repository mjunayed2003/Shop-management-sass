import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiHeader, ApiParam } from '@nestjs/swagger';
import { BarcodeService } from '../services/barcode.service.js';
import { PrintBarcodeDto } from '../dto/barcode.dto.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { CurrentBranch } from '../../../common/decorators/current-branch.decorator.js';
import type { BranchContext } from '../../../common/decorators/current-branch.decorator.js';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '../../../common/constants/permissions.constant.js';

@ApiTags('Catalog: Barcodes & Labels')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-branch-id',
  required: true,
  description: 'Current branch context UUID for barcode print logging and branch availability checking',
})
@Controller('api/v1/catalog/barcodes')
export class BarcodeController {
  constructor(private readonly barcodeService: BarcodeService) {}

  @Post('print')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.BARCODE_PRINT)
  @ApiOperation({
    summary: 'Log barcode printing and return label data for rendering',
    description:
      'Creates a BarcodePrintLog record and formats label data (product title, SKU, size, color, price, barcode). Requires audit reason if printType is REPRINT.',
  })
  @ApiResponse({ status: 200, description: 'Barcode print logged and label data returned' })
  @ApiResponse({ status: 400, description: 'Reason required for reprint' })
  async printBarcode(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Body() dto: PrintBarcodeDto,
  ) {
    return this.barcodeService.printBarcode(
      user.businessId,
      branchContext.branchId,
      user.id,
      dto,
    );
  }

  @Get('lookup/:barcode')
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  @ApiOperation({
    summary: 'Branch-aware barcode lookup for POS scanning',
    description:
      'Scans a barcode. If the product is active in the current branch, returns the variant and branch stock. If the product exists in the business but NOT in the current branch, returns a distinct PRODUCT_IN_OTHER_BRANCH response with stock in other branches.',
  })
  @ApiParam({ name: 'barcode', description: 'Scanned barcode string' })
  @ApiResponse({ status: 200, description: 'Product found (active in current branch or in other branches)' })
  @ApiResponse({ status: 404, description: 'Barcode not found in business' })
  async lookupBarcode(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBranch() branchContext: BranchContext,
    @Param('barcode') barcode: string,
  ) {
    return this.barcodeService.lookupBarcode(
      user.businessId,
      branchContext.branchId,
      barcode,
    );
  }
}
