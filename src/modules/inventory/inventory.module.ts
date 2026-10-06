import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';

// Services
import { SequenceService } from './services/sequence.service.js';
import { StockService } from './services/stock.service.js';
import { SupplierService } from './services/supplier.service.js';
import { PurchaseOrderService } from './services/purchase-order.service.js';
import { PurchaseService } from './services/purchase.service.js';
import { SupplierPaymentService } from './services/supplier-payment.service.js';
import { PurchaseReturnService } from './services/purchase-return.service.js';
import { StockTransferService } from './services/stock-transfer.service.js';
import { StockAdjustmentService } from './services/stock-adjustment.service.js';
import { StocktakeService } from './services/stocktake.service.js';
import { DamagedStockService } from './services/damaged-stock.service.js';

// Controllers
import { StockController } from './controllers/stock.controller.js';
import { SupplierController } from './controllers/supplier.controller.js';
import { PurchaseOrderController } from './controllers/purchase-order.controller.js';
import { PurchaseController } from './controllers/purchase.controller.js';
import { SupplierPaymentController } from './controllers/supplier-payment.controller.js';
import { PurchaseReturnController } from './controllers/purchase-return.controller.js';
import { StockTransferController } from './controllers/stock-transfer.controller.js';
import { StockAdjustmentController } from './controllers/stock-adjustment.controller.js';
import { StocktakeController } from './controllers/stocktake.controller.js';
import { DamagedStockController } from './controllers/damaged-stock.controller.js';

@Module({
  imports: [PrismaModule, CatalogModule],
  controllers: [
    StockController,
    SupplierController,
    PurchaseOrderController,
    PurchaseController,
    SupplierPaymentController,
    PurchaseReturnController,
    StockTransferController,
    StockAdjustmentController,
    StocktakeController,
    DamagedStockController,
  ],
  providers: [
    SequenceService,
    StockService,
    SupplierService,
    PurchaseOrderService,
    PurchaseService,
    SupplierPaymentService,
    PurchaseReturnService,
    StockTransferService,
    StockAdjustmentService,
    StocktakeService,
    DamagedStockService,
  ],
  exports: [
    SequenceService,
    StockService,
    SupplierService,
    PurchaseOrderService,
    PurchaseService,
    SupplierPaymentService,
    PurchaseReturnService,
    StockTransferService,
    StockAdjustmentService,
    StocktakeService,
    DamagedStockService,
  ],
})
export class InventoryModule {}
