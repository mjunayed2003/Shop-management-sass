import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';

// Services
import { PhoneNormalizerService } from './services/phone-normalizer.service.js';
import { CustomerService } from './services/customer.service.js';
import { RegisterSessionService } from './services/register-session.service.js';
import { SmsStubService } from './services/sms-stub.service.js';
import { PricingService } from './services/pricing.service.js';
import { HeldSaleService } from './services/held-sale.service.js';
import { SaleService } from './services/sale.service.js';
import { SalesReturnService } from './services/sales-return.service.js';
import { ExchangeService } from './services/exchange.service.js';
import { DueCollectionService } from './services/due-collection.service.js';
import { ReportService } from './services/report.service.js';

// Controllers
import { CustomerController } from './controllers/customer.controller.js';
import { RegisterSessionController } from './controllers/register-session.controller.js';
import { HeldSaleController } from './controllers/held-sale.controller.js';
import { SaleController } from './controllers/sale.controller.js';
import { SalesReturnController } from './controllers/sales-return.controller.js';
import { ExchangeController } from './controllers/exchange.controller.js';
import { DueCollectionController } from './controllers/due-collection.controller.js';
import { ReportController } from './controllers/report.controller.js';

@Module({
  imports: [PrismaModule, CatalogModule, InventoryModule],
  controllers: [
    CustomerController,
    RegisterSessionController,
    HeldSaleController,
    SaleController,
    SalesReturnController,
    ExchangeController,
    DueCollectionController,
    ReportController,
  ],
  providers: [
    PhoneNormalizerService,
    CustomerService,
    RegisterSessionService,
    SmsStubService,
    PricingService,
    HeldSaleService,
    SaleService,
    SalesReturnService,
    ExchangeService,
    DueCollectionService,
    ReportService,
  ],
  exports: [
    PhoneNormalizerService,
    CustomerService,
    RegisterSessionService,
    SmsStubService,
    PricingService,
    HeldSaleService,
    SaleService,
    SalesReturnService,
    ExchangeService,
    DueCollectionService,
    ReportService,
  ],
})
export class SalesModule {}
