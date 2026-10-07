import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { SalesModule } from '../sales/sales.module.js';

import { ExpenseCategoryService } from './services/expense-category.service.js';
import { ExpenseService } from './services/expense.service.js';
import { LocalDiskFileStorageService } from './services/file-storage.service.js';

import { ExpenseCategoryController } from './controllers/expense-category.controller.js';
import { ExpenseController } from './controllers/expense.controller.js';

@Module({
  imports: [PrismaModule, InventoryModule, SalesModule],
  controllers: [ExpenseCategoryController, ExpenseController],
  providers: [
    ExpenseCategoryService,
    ExpenseService,
    LocalDiskFileStorageService,
  ],
  exports: [
    ExpenseCategoryService,
    ExpenseService,
    LocalDiskFileStorageService,
  ],
})
export class ExpenseModule {}
