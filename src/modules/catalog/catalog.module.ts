import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';

// Services
import { MasterDataService } from './services/master-data.service.js';
import { ProductService } from './services/product.service.js';
import { VariantService } from './services/variant.service.js';
import { ProductBranchService } from './services/product-branch.service.js';
import { BarcodeService } from './services/barcode.service.js';
import { PriceListService } from './services/price-list.service.js';

// Controllers
import { MasterDataController } from './controllers/master-data.controller.js';
import { ProductController } from './controllers/product.controller.js';
import { VariantController } from './controllers/variant.controller.js';
import { ProductBranchController } from './controllers/product-branch.controller.js';
import { BarcodeController } from './controllers/barcode.controller.js';
import { PriceListController } from './controllers/price-list.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [
    MasterDataController,
    ProductController,
    VariantController,
    ProductBranchController,
    BarcodeController,
    PriceListController,
  ],
  providers: [
    MasterDataService,
    ProductService,
    VariantService,
    ProductBranchService,
    BarcodeService,
    PriceListService,
  ],
  exports: [
    MasterDataService,
    ProductService,
    VariantService,
    ProductBranchService,
    BarcodeService,
    PriceListService,
  ],
})
export class CatalogModule {}
