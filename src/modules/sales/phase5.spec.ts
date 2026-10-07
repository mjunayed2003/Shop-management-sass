import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { SalesReturnService } from './services/sales-return.service.js';
import { ExchangeService } from './services/exchange.service.js';
import { DueCollectionService } from './services/due-collection.service.js';
import { RegisterSessionService } from './services/register-session.service.js';
import { SaleService } from './services/sale.service.js';
import { CustomerService } from './services/customer.service.js';
import { PhoneNormalizerService } from './services/phone-normalizer.service.js';
import { PricingService } from './services/pricing.service.js';
import { SmsStubService } from './services/sms-stub.service.js';
import { ReportService } from './services/report.service.js';
import { SequenceService } from '../inventory/services/sequence.service.js';
import { ExpenseService } from '../expense/services/expense.service.js';
import { LocalDiskFileStorageService } from '../expense/services/file-storage.service.js';

describe('Phase 5: Returns, Exchange, Due Collection, Expenses, Cash, Register Close', () => {
  let mockPrisma: any;
  let salesReturnService: SalesReturnService;
  let exchangeService: ExchangeService;
  let dueCollectionService: DueCollectionService;
  let registerSessionService: RegisterSessionService;
  let saleService: SaleService;
  let customerService: CustomerService;
  let phoneNormalizer: PhoneNormalizerService;
  let reportService: ReportService;
  let expenseService: ExpenseService;
  let sequenceService: SequenceService;
  let smsStubService: SmsStubService;
  let mockStockService: any;
  let mockFileStorage: any;

  const businessId = 'biz-001';
  const branch1Id = 'branch-gulshan';
  const branch2Id = 'branch-dhanmondi';
  const cashierId = 'user-cashier-1';
  const managerId = 'user-mgr-1';
  const customer1Id = 'cust-001';
  const variant1Id = 'var-polo-m';
  const sale1Id = 'sale-001';
  const saleItemId1 = 'si-001';
  const sessionId = 'session-gulshan-1';

  beforeEach(() => {
    mockPrisma = {
      $transaction: vi.fn().mockImplementation((cb: any) => cb(mockPrisma)),
      $queryRaw: vi.fn().mockResolvedValue([]),
      sale: {
        findFirst: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
        groupBy: vi.fn(),
        count: vi.fn(),
      },
      saleItem: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
      },
      salePayment: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
      salesReturn: {
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        count: vi.fn(),
      },
      exchange: {
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        count: vi.fn(),
      },
      exchangeItem: {
        createMany: vi.fn(),
      },
      dueCollection: {
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        count: vi.fn(),
      },
      customer: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
      },
      cashRegister: {
        findFirst: vi.fn(),
      },
      registerSession: {
        findFirst: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
      },
      cashMovement: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
      expenseCategory: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      expense: {
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      },
      damagedStock: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
      productUnit: {
        updateMany: vi.fn(),
      },
      productVariant: {
        findUnique: vi.fn(),
      },
      business: {
        findUnique: vi.fn().mockResolvedValue({
          id: businessId,
        }),
      },
      systemSetting: {
        findUnique: vi.fn().mockImplementation((args: any) => {
          if (args?.where?.key === 'return_window_days') return Promise.resolve({ value: '30' });
          if (args?.where?.key === 'discrepancy_threshold') return Promise.resolve({ value: '0' });
          return Promise.resolve(null);
        }),
      },
      branch: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([
          { id: branch1Id, name: 'Gulshan Branch', code: 'GUL' },
          { id: branch2Id, name: 'Dhanmondi Branch', code: 'DHA' },
        ]),
      },
      attachment: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
      notification: {
        create: vi.fn(),
      },
      smsLog: {
        create: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      invoiceSequence: {
        upsert: vi.fn().mockResolvedValue({
          next_number: 2,
          prefix: 'DOC-',
          created_at: new Date(1000),
          updated_at: new Date(1000),
        }),
      },
    };

    mockStockService = {
      applyMovement: vi.fn().mockResolvedValue({
        balance: { id: 'sb-1', quantity: new Prisma.Decimal(10) },
        movement: { id: 'sm-1', unit_cost: new Prisma.Decimal(800) },
        newWac: new Prisma.Decimal(800),
      }),
    };

    sequenceService = new SequenceService();
    phoneNormalizer = new PhoneNormalizerService();
    customerService = new CustomerService(mockPrisma, phoneNormalizer);
    registerSessionService = new RegisterSessionService(mockPrisma);
    smsStubService = new SmsStubService();
    mockFileStorage = { saveFile: vi.fn().mockResolvedValue({ filePath: 'uploads/f.jpg', fileName: 'f.jpg', fileSize: 100, mimeType: 'image/jpeg' }) };

    salesReturnService = new SalesReturnService(
      mockPrisma,
      mockStockService,
      sequenceService,
      registerSessionService,
    );

    // Mock SaleService createSale for exchange testing
    saleService = {
      createSale: vi.fn(),
    } as any;

    exchangeService = new ExchangeService(
      mockPrisma,
      salesReturnService,
      saleService,
      sequenceService,
      registerSessionService,
    );

    dueCollectionService = new DueCollectionService(
      mockPrisma,
      sequenceService,
      registerSessionService,
      smsStubService,
    );

    expenseService = new ExpenseService(
      mockPrisma,
      sequenceService,
      registerSessionService,
      mockFileStorage,
    );

    reportService = new ReportService(mockPrisma);
  });

  describe('A. Sales Returns', () => {
    it('Return cannot exceed sold quantity', async () => {
      mockPrisma.sale.findFirst.mockResolvedValue({
        id: sale1Id,
        invoice_no: 'INV-000001',
        branch_id: branch1Id,
        status: 'COMPLETED',
        sale_date: new Date(),
        due_amount: new Prisma.Decimal(0),
        paid_amount: new Prisma.Decimal(1000),
        total_amount: new Prisma.Decimal(1000),
        items: [
          {
            id: saleItemId1,
            product_variant_id: variant1Id,
            quantity: new Prisma.Decimal(2),
            returned_qty: new Prisma.Decimal(1),
            total_amount: new Prisma.Decimal(1000),
            unit_cost: new Prisma.Decimal(400),
          },
        ],
      });

      mockPrisma.saleItem.findMany.mockResolvedValue([
        {
          id: saleItemId1,
          quantity: new Prisma.Decimal(2),
          returned_qty: new Prisma.Decimal(1), // 1 remaining
          total_amount: new Prisma.Decimal(1000),
          unit_cost: new Prisma.Decimal(400),
          product_variant_id: variant1Id,
        },
      ]);

      // Try returning 2 (only 1 available)
      await expect(
        salesReturnService.createReturn(businessId, branch1Id, cashierId, {
          saleId: sale1Id,
          items: [{ saleItemId: saleItemId1, quantity: 2 }],
          refundMethod: 'CASH',
          idempotencyKey: 'ret-idem-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('Resellable return restores stock at original unit_cost; damaged return creates DamagedStock and write-off', async () => {
      mockPrisma.sale.findFirst.mockResolvedValue({
        id: sale1Id,
        invoice_no: 'INV-000001',
        branch_id: branch1Id,
        status: 'COMPLETED',
        sale_date: new Date(),
        due_amount: new Prisma.Decimal(0),
        paid_amount: new Prisma.Decimal(2000),
        total_amount: new Prisma.Decimal(2000),
        customer_id: null,
        items: [
          {
            id: saleItemId1,
            product_variant_id: variant1Id,
            quantity: new Prisma.Decimal(2),
            returned_qty: new Prisma.Decimal(0),
            total_amount: new Prisma.Decimal(2000),
            unit_cost: new Prisma.Decimal(700),
          },
        ],
      });

      mockPrisma.saleItem.findMany.mockResolvedValue([
        {
          id: saleItemId1,
          quantity: new Prisma.Decimal(2),
          returned_qty: new Prisma.Decimal(0),
          total_amount: new Prisma.Decimal(2000),
          unit_cost: new Prisma.Decimal(700),
          product_variant_id: variant1Id,
        },
      ]);

      mockPrisma.registerSession.findFirst.mockResolvedValue({ id: sessionId, status: 'OPEN' });
      mockPrisma.salesReturn.create.mockResolvedValue({ id: 'ret-1', return_no: 'SR-000001', items: [] });

      // 1. Resellable
      await salesReturnService.createReturn(businessId, branch1Id, cashierId, {
        saleId: sale1Id,
        items: [{ saleItemId: saleItemId1, quantity: 1, condition: 'RESELLABLE' }],
        refundMethod: 'CASH',
        idempotencyKey: 'ret-idem-resell',
      });

      expect(mockStockService.applyMovement).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          movementType: 'SALE_RETURN',
          unitCost: expect.objectContaining({ s: 1, e: 2, d: [700] }),
        }),
      );

      // 2. Damaged
      await salesReturnService.createReturn(businessId, branch1Id, cashierId, {
        saleId: sale1Id,
        items: [{ saleItemId: saleItemId1, quantity: 1, condition: 'DAMAGED' }],
        refundMethod: 'CASH',
        idempotencyKey: 'ret-idem-damage',
      });

      // Verify stock in + stock out (DAMAGE) + DamagedStock create
      expect(mockStockService.applyMovement).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({ movementType: 'DAMAGE' }),
      );
      expect(mockPrisma.damagedStock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'WRITTEN_OFF',
            product_variant_id: variant1Id,
          }),
        }),
      );
    });

    it('Return on a sale with outstanding due reduces due first, then refunds remainder', async () => {
      // Sale: total 1000, paid 600, due 400. Customer current_due = 400.
      mockPrisma.sale.findFirst.mockResolvedValue({
        id: sale1Id,
        invoice_no: 'INV-000001',
        branch_id: branch1Id,
        status: 'PARTIALLY_PAID',
        sale_date: new Date(),
        due_amount: new Prisma.Decimal(400),
        paid_amount: new Prisma.Decimal(600),
        total_amount: new Prisma.Decimal(1000),
        customer_id: customer1Id,
        items: [
          {
            id: saleItemId1,
            product_variant_id: variant1Id,
            quantity: new Prisma.Decimal(2),
            returned_qty: new Prisma.Decimal(0),
            total_amount: new Prisma.Decimal(1000), // 500 each
            unit_cost: new Prisma.Decimal(300),
          },
        ],
      });

      mockPrisma.saleItem.findMany.mockResolvedValue([
        {
          id: saleItemId1,
          quantity: new Prisma.Decimal(2),
          returned_qty: new Prisma.Decimal(0),
          total_amount: new Prisma.Decimal(1000),
          unit_cost: new Prisma.Decimal(300),
          product_variant_id: variant1Id,
        },
      ]);

      mockPrisma.registerSession.findFirst.mockResolvedValue({ id: sessionId, status: 'OPEN' });
      mockPrisma.salesReturn.create.mockResolvedValue({
        id: 'ret-due',
        return_no: 'SR-000002',
        total_refund_amount: new Prisma.Decimal(1000),
        items: [],
      });

      // Returning 2 units = 1000 refund
      // First 400 reduces due to 0 (and customer due by 400)
      // Remainder 600 is paid out in CASH
      const res = await salesReturnService.createReturn(businessId, branch1Id, cashierId, {
        saleId: sale1Id,
        items: [{ saleItemId: saleItemId1, quantity: 2 }],
        refundMethod: 'CASH',
        idempotencyKey: 'ret-due-test',
      });

      expect(res.dueReduction).toBe('400');
      expect(res.payoutAmount).toBe('600');
      expect(mockPrisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { current_due: { decrement: expect.any(Prisma.Decimal) } },
        }),
      );
      expect(mockPrisma.sale.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            due_amount: new Prisma.Decimal(0),
            paid_amount: new Prisma.Decimal(0),
            status: 'RETURNED',
          }),
        }),
      );
    });

    it('Return of VOIDED sale rejected; return outside window rejected', async () => {
      // 1. VOIDED
      mockPrisma.sale.findFirst.mockResolvedValueOnce({
        id: sale1Id,
        invoice_no: 'INV-VOID',
        branch_id: branch1Id,
        status: 'VOIDED',
        sale_date: new Date(),
        items: [],
      });

      await expect(
        salesReturnService.createReturn(businessId, branch1Id, cashierId, {
          saleId: sale1Id,
          items: [{ saleItemId: saleItemId1, quantity: 1 }],
          refundMethod: 'CASH',
          idempotencyKey: 'ret-void',
        }),
      ).rejects.toThrow('Cannot process return against a VOIDED invoice.');

      // 2. Outside window (> 30 days)
      const pastDate = new Date(Date.now() - 40 * 24 * 3600 * 1000);
      mockPrisma.sale.findFirst.mockResolvedValueOnce({
        id: sale1Id,
        invoice_no: 'INV-OLD',
        branch_id: branch1Id,
        status: 'COMPLETED',
        sale_date: pastDate,
        items: [],
      });

      await expect(
        salesReturnService.createReturn(businessId, branch1Id, cashierId, {
          saleId: sale1Id,
          items: [{ saleItemId: saleItemId1, quantity: 1 }],
          refundMethod: 'CASH',
          idempotencyKey: 'ret-old',
        }),
      ).rejects.toThrow(/Return window of 30 days has expired/);
    });

    it('Cross-branch return requires return.cross_branch permission', async () => {
      mockPrisma.sale.findFirst.mockResolvedValue({
        id: sale1Id,
        invoice_no: 'INV-OTHER-BRANCH',
        branch_id: branch2Id, // Sold in branch2 (Dhanmondi)
        status: 'COMPLETED',
        sale_date: new Date(),
        due_amount: new Prisma.Decimal(0),
        paid_amount: new Prisma.Decimal(500),
        total_amount: new Prisma.Decimal(500),
        items: [{ id: saleItemId1, quantity: new Prisma.Decimal(1), returned_qty: new Prisma.Decimal(0), total_amount: new Prisma.Decimal(500), unit_cost: new Prisma.Decimal(250), product_variant_id: variant1Id }],
      });

      mockPrisma.saleItem.findMany.mockResolvedValue([
        { id: saleItemId1, quantity: new Prisma.Decimal(1), returned_qty: new Prisma.Decimal(0), total_amount: new Prisma.Decimal(500), unit_cost: new Prisma.Decimal(250), product_variant_id: variant1Id },
      ]);

      // Processing in branch1 (Gulshan) without cross-branch permission
      await expect(
        salesReturnService.createReturn(
          businessId,
          branch1Id,
          cashierId,
          {
            saleId: sale1Id,
            items: [{ saleItemId: saleItemId1, quantity: 1 }],
            refundMethod: 'CASH',
            idempotencyKey: 'ret-cb-fail',
          },
          { code: 'CASHIER', name: 'Cashier', permissions: ['return.create'] },
        ),
      ).rejects.toThrow(ForbiddenException);

      // Processing with return.cross_branch permission
      mockPrisma.registerSession.findFirst.mockResolvedValue({ id: sessionId, status: 'OPEN' });
      mockPrisma.salesReturn.create.mockResolvedValue({ id: 'ret-cb-ok', return_no: 'SR-000003', items: [] });

      const cbResult = await salesReturnService.createReturn(
        businessId,
        branch1Id,
        cashierId,
        {
          saleId: sale1Id,
          items: [{ saleItemId: saleItemId1, quantity: 1 }],
          refundMethod: 'CASH',
          idempotencyKey: 'ret-cb-success',
        },
        { code: 'CASHIER', name: 'Cashier', permissions: ['return.create', 'return.cross_branch'] },
      );

      expect(cbResult.crossBranchAccepted).toBe(true);
      expect(cbResult.acceptingBranchId).toBe(branch1Id);
    });

    it('STORE_CREDIT refund rejected', async () => {
      mockPrisma.sale.findFirst.mockResolvedValue({
        id: sale1Id,
        branch_id: branch1Id,
        status: 'COMPLETED',
        sale_date: new Date(),
        items: [],
      });

      await expect(
        salesReturnService.createReturn(businessId, branch1Id, cashierId, {
          saleId: sale1Id,
          items: [{ saleItemId: saleItemId1, quantity: 1 }],
          refundMethod: 'STORE_CREDIT' as any,
          idempotencyKey: 'ret-sc',
        }),
      ).rejects.toThrow(/STORE_CREDIT refund method is not supported/);
    });

    it('Tracked unit return restores unit to IN_STOCK and updates branch', async () => {
      mockPrisma.sale.findFirst.mockResolvedValue({
        id: sale1Id,
        branch_id: branch1Id,
        status: 'COMPLETED',
        sale_date: new Date(),
        due_amount: new Prisma.Decimal(0),
        paid_amount: new Prisma.Decimal(1200),
        total_amount: new Prisma.Decimal(1200),
        items: [{ id: saleItemId1, quantity: new Prisma.Decimal(1), returned_qty: new Prisma.Decimal(0), total_amount: new Prisma.Decimal(1200), unit_cost: new Prisma.Decimal(600), product_variant_id: variant1Id }],
      });
      mockPrisma.saleItem.findMany.mockResolvedValue([
        { id: saleItemId1, quantity: new Prisma.Decimal(1), returned_qty: new Prisma.Decimal(0), total_amount: new Prisma.Decimal(1200), unit_cost: new Prisma.Decimal(600), product_variant_id: variant1Id },
      ]);
      mockPrisma.registerSession.findFirst.mockResolvedValue({ id: sessionId, status: 'OPEN' });
      mockPrisma.salesReturn.create.mockResolvedValue({ id: 'ret-tr', return_no: 'SR-000004', items: [] });

      await salesReturnService.createReturn(businessId, branch1Id, cashierId, {
        saleId: sale1Id,
        items: [{ saleItemId: saleItemId1, quantity: 1, condition: 'RESELLABLE', trackedUnitBarcodes: ['UNIT-BARCODE-01'] }],
        refundMethod: 'CASH',
        idempotencyKey: 'ret-unit-test',
      });

      expect(mockPrisma.productUnit.updateMany).toHaveBeenCalledWith({
        where: { business_id: businessId, barcode_value: { in: ['UNIT-BARCODE-01'] } },
        data: { status: 'IN_STOCK', branch_id: branch1Id },
      });
    });
  });

  describe('B. Exchanges', () => {
    it('Exchange: customer pays difference and creates Exchange with credit applied', async () => {
      // Returned item: 800 value
      mockPrisma.sale.findFirst.mockResolvedValue({
        id: sale1Id,
        invoice_no: 'INV-001',
        branch_id: branch1Id,
        status: 'COMPLETED',
        sale_date: new Date(),
        due_amount: new Prisma.Decimal(0),
        paid_amount: new Prisma.Decimal(800),
        total_amount: new Prisma.Decimal(800),
        items: [{ id: saleItemId1, quantity: new Prisma.Decimal(1), returned_qty: new Prisma.Decimal(0), total_amount: new Prisma.Decimal(800), unit_cost: new Prisma.Decimal(400), product_variant_id: variant1Id }],
      });

      mockPrisma.saleItem.findMany.mockResolvedValue([
        { id: saleItemId1, quantity: new Prisma.Decimal(1), returned_qty: new Prisma.Decimal(0), total_amount: new Prisma.Decimal(800), unit_cost: new Prisma.Decimal(400), product_variant_id: variant1Id },
      ]);

      mockPrisma.registerSession.findFirst.mockResolvedValue({ id: sessionId, status: 'OPEN' });
      mockPrisma.salesReturn.create.mockResolvedValue({
        id: 'ret-for-exc',
        total_refund_amount: new Prisma.Decimal(800),
        items: [{ sale_item_id: saleItemId1, product_variant_id: variant1Id, quantity: new Prisma.Decimal(1), refund_price: new Prisma.Decimal(800), total_refund: new Prisma.Decimal(800) }],
      });

      // New sale takes 1200 items (difference = +400, customer pays 400)
      (saleService.createSale as any).mockResolvedValue({
        id: 'sale-new-1',
        invoice_no: 'INV-NEW-01',
        totalAmount: 1200,
        paidAmount: 1200, // 800 credit + 400 cash
      });

      mockPrisma.exchange.create.mockResolvedValue({
        id: 'exc-1',
        exchange_no: 'EXC-000001',
        returned_total: new Prisma.Decimal(800),
        new_items_total: new Prisma.Decimal(1200),
        difference_amount: new Prisma.Decimal(400),
        adjustment_status: 'CUSTOMER_PAID',
      });

      const exchangeResult = await exchangeService.createExchange(businessId, branch1Id, cashierId, {
        originalSaleId: sale1Id,
        returnedItems: [{ saleItemId: saleItemId1, quantity: 1 }],
        newItems: [{ variantId: 'var-polo-l', quantity: 1 }],
        payments: [{ paymentMethod: 'CASH' as any, amount: 400 }],
        idempotencyKey: 'exc-test-1',
      });

      expect(saleService.createSale).toHaveBeenCalledWith(
        businessId,
        branch1Id,
        cashierId,
        expect.objectContaining({ payments: [{ paymentMethod: 'CASH', amount: 400 }] }),
        undefined,
        expect.objectContaining({ exchangeCreditAmount: expect.any(Prisma.Decimal) }),
      );
      expect(mockPrisma.exchange.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            adjustment_status: 'CUSTOMER_PAID',
            difference_amount: expect.any(Prisma.Decimal),
          }),
        }),
      );
    });

    it('Exchange idempotency: duplicate key returns cached record', async () => {
      mockPrisma.exchange.findFirst.mockResolvedValue({
        id: 'exc-existing',
        exchange_no: 'EXC-EXIST',
        idempotency_key: 'exc-idem-repeat',
      });

      const res = await exchangeService.createExchange(businessId, branch1Id, cashierId, {
        originalSaleId: sale1Id,
        returnedItems: [{ saleItemId: saleItemId1, quantity: 1 }],
        newItems: [{ variantId: 'var-1', quantity: 1 }],
        idempotencyKey: 'exc-idem-repeat',
      });

      expect(res.id).toBe('exc-existing');
      expect(mockPrisma.sale.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('C. Due Collection', () => {
    it('Allocates oldest first across sales and decreases customer current_due', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({
        id: customer1Id,
        name: 'Morsalin Kabir',
        phone: '01711223344',
        current_due: new Prisma.Decimal(1500),
      });

      // 2 Sales with due: Sale 1 (due 600, branch1), Sale 2 (due 900, branch2)
      mockPrisma.sale.findMany.mockResolvedValue([
        { id: 's-old', invoice_no: 'INV-OLD', branch_id: branch1Id, due_amount: new Prisma.Decimal(600), paid_amount: new Prisma.Decimal(400) },
        { id: 's-new', invoice_no: 'INV-NEW', branch_id: branch2Id, due_amount: new Prisma.Decimal(900), paid_amount: new Prisma.Decimal(100) },
      ]);

      mockPrisma.registerSession.findFirst.mockResolvedValue({ id: sessionId, status: 'OPEN' });
      mockPrisma.customer.update.mockResolvedValue({ id: customer1Id, current_due: new Prisma.Decimal(500) });
      mockPrisma.dueCollection.create.mockResolvedValue({
        id: 'col-1',
        collection_no: 'COL-000001',
        amount: new Prisma.Decimal(1000),
      });

      // Pay 1000 in branch1:
      // First 600 clears Sale 1 completely (due=0, status=COMPLETED)
      // Remaining 400 applies to Sale 2 in branch2 (due 900->500, status=PARTIALLY_PAID)
      const colRes = await dueCollectionService.collectDue(businessId, branch1Id, cashierId, {
        customerId: customer1Id,
        amount: 1000,
        paymentMethod: 'CASH',
        idempotencyKey: 'col-idem-1',
      });

      expect(colRes.allocations).toEqual([
        { saleId: 's-old', invoiceNo: 'INV-OLD', branchId: branch1Id, amountApplied: '600' },
        { saleId: 's-new', invoiceNo: 'INV-NEW', branchId: branch2Id, amountApplied: '400' },
      ]);
      expect(colRes.remainingDue).toBe('500');
    });

    it('Overpayment above customer due is rejected', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({
        id: customer1Id,
        current_due: new Prisma.Decimal(500),
      });

      await expect(
        dueCollectionService.collectDue(businessId, branch1Id, cashierId, {
          customerId: customer1Id,
          amount: 800, // over current due
          paymentMethod: 'CASH',
          idempotencyKey: 'col-overpay',
        }),
      ).rejects.toThrow(/Advance payments are not supported/);
    });
  });

  describe('D. Showroom Expenses', () => {
    it('Server computes total amount; paid_from_register enforces OPEN session and links session', async () => {
      mockPrisma.expenseCategory.findFirst.mockResolvedValue({ id: 'cat-1', name: 'Refreshments' });
      mockPrisma.registerSession.findFirst.mockResolvedValue({ id: sessionId, status: 'OPEN' });
      mockPrisma.expense.create.mockImplementation((args: any) => ({
        id: 'exp-1',
        ...args.data,
      }));

      const exp = await expenseService.createExpense(businessId, branch1Id, cashierId, {
        expenseCategoryId: 'cat-1',
        amount: 1500,
        taxAmount: 75,
        paidFromRegister: true,
        paymentMethod: 'CASH',
      });

      expect(exp.total_amount).toEqual(new Prisma.Decimal(1575));
      expect(exp.register_session_id).toBe(sessionId);
      expect(exp.paid_from_register).toBe(true);
    });

    it('paid_from_register rejected if paymentMethod is non-CASH or session is missing', async () => {
      mockPrisma.expenseCategory.findFirst.mockResolvedValue({ id: 'cat-1' });

      // Non-cash with paid_from_register
      await expect(
        expenseService.createExpense(businessId, branch1Id, cashierId, {
          expenseCategoryId: 'cat-1',
          amount: 500,
          paidFromRegister: true,
          paymentMethod: 'BKASH',
        }),
      ).rejects.toThrow('paid_from_register is only valid when paymentMethod is CASH.');
    });
  });

  describe('E. Cash Movements', () => {
    it('Cash pay-out above current drawer cash is rejected', async () => {
      mockPrisma.registerSession.findFirst.mockResolvedValue({ id: sessionId, status: 'OPEN' });
      mockPrisma.registerSession.findUniqueOrThrow.mockResolvedValue({
        id: sessionId,
        opening_balance: new Prisma.Decimal(1000),
        cash_register: { name: 'Counter 1' },
        user: { first_name: 'Cashier' },
      });

      // No sales or pay-ins, drawer has 1000
      await expect(
        registerSessionService.createCashMovement(businessId, branch1Id, cashierId, {
          type: 'PAY_OUT',
          amount: 1500, // exceeds 1000
          reason: 'Emergency showroom repairs',
        }),
      ).rejects.toThrow(/exceeds current drawer cash/);
    });
  });

  describe('F. Register Close & Reconciliation (X/Z Reports)', () => {
    it('Calculates expected_balance = opening + cash sales + cash dues + pay_ins - pay_outs - refunds - expenses', async () => {
      // Opening: 2000
      // Cash Sales: 3500 (4000 cash - 500 voided cash reversal)
      // Cash Dues: 1000
      // Pay-ins: 300
      // Pay-outs: 200
      // Cash Return refund: 400
      // Cash Exchange refund: 200
      // Cash Expenses: 500
      // Expected = 2000 + 3500 + 1000 + 300 - 200 - (400 + 200) - 500 = 5500
      mockPrisma.registerSession.findUniqueOrThrow.mockResolvedValue({
        id: sessionId,
        opening_balance: new Prisma.Decimal(2000),
        cash_register: { name: 'Counter 1' },
        user: { first_name: 'Cashier', last_name: 'One' },
      });

      mockPrisma.salePayment.findMany.mockResolvedValue([
        { amount: new Prisma.Decimal(4000), payment_method: 'CASH' },
        { amount: new Prisma.Decimal(-500), payment_method: 'CASH' }, // Void reversal
        { amount: new Prisma.Decimal(1200), payment_method: 'BKASH' }, // Non-cash
      ]);

      mockPrisma.dueCollection.findMany.mockResolvedValue([
        { amount: new Prisma.Decimal(1000), payment_method: 'CASH' },
      ]);

      mockPrisma.cashMovement.findMany.mockResolvedValue([
        { amount: new Prisma.Decimal(300), type: 'PAY_IN' },
        { amount: new Prisma.Decimal(200), type: 'PAY_OUT' },
      ]);

      mockPrisma.salesReturn.findMany.mockResolvedValue([
        { total_refund_amount: new Prisma.Decimal(400), refund_method: 'CASH' },
      ]);

      mockPrisma.exchange.findMany.mockResolvedValue([
        { difference_amount: new Prisma.Decimal(-200), adjustment_status: 'SHOP_REFUNDED' },
      ]);

      mockPrisma.expense.findMany.mockResolvedValue([
        { total_amount: new Prisma.Decimal(500) },
      ]);

      const summary = await registerSessionService.calculateSessionSummary(sessionId);

      expect(summary.expected_balance).toBe('5500');
      expect(summary.non_cash_totals.BKASH).toBe('1200');
    });

    it('Closes session, computes discrepancy, and enforces closing notes on discrepancy', async () => {
      mockPrisma.registerSession.findFirst.mockResolvedValue({
        id: sessionId,
        user_id: cashierId,
        status: 'OPEN',
        user: { first_name: 'Cashier', last_name: 'One' },
      });
      mockPrisma.registerSession.findUniqueOrThrow.mockResolvedValue({
        id: sessionId,
        opening_balance: new Prisma.Decimal(1000),
        cash_register: { name: 'Counter 1' },
        user: { first_name: 'Cashier', last_name: 'One' },
      });
      mockPrisma.registerSession.update.mockImplementation((args: any) => ({
        id: sessionId,
        ...args.data,
        cash_register: { name: 'Counter 1' },
        user: { first_name: 'Cashier', last_name: 'One' },
      }));

      // Expected is 1000, cashier counts 950 (discrepancy = -50)
      // Without closing notes -> rejected
      await expect(
        registerSessionService.closeSession(
          businessId,
          branch1Id,
          cashierId,
          { closingBalance: 950 },
          { code: 'CASHIER', name: 'Cashier', permissions: ['register.close'] },
        ),
      ).rejects.toThrow(/Closing notes are required when there is a cash discrepancy/);

      // With closing notes -> succeeds and alerts managers
      const closeRes = await registerSessionService.closeSession(
        businessId,
        branch1Id,
        cashierId,
        { closingBalance: 950, closingNotes: 'Short 50 Tk due to minor cashier error' },
        { code: 'CASHIER', name: 'Cashier', permissions: ['register.close'] },
      );

      expect(closeRes.session.status).toBe('CLOSED');
      expect(closeRes.zReport.discrepancy).toBe('-50');
      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'SYSTEM_ALERT',
            title: 'Register Discrepancy Alert',
          }),
        }),
      );
    });
  });

  describe('G. Profit & Collections Report', () => {
    it('Profit report matches calculation: gross sales - discounts - returns - COGS - expenses', async () => {
      // Gulshan branch:
      // Gross sales = 10,000, discounts = 500, sale COGS = 6,000
      // Sales return = 1,000, returned cost = 600
      // Expenses = 800
      // Net Sales = 10,000 - 500 - 1,000 = 8,500
      // COGS = 6,000 - 600 = 5,400
      // Gross Profit = 8,500 - 5,400 = 3,100
      // Net Profit = 3,100 - 800 = 2,300
      mockPrisma.sale.findMany.mockResolvedValue([
        { subtotal: new Prisma.Decimal(10000), discount_amount: new Prisma.Decimal(500), total_cost: new Prisma.Decimal(6000) },
      ]);

      mockPrisma.salesReturn.findMany.mockResolvedValue([
        {
          total_refund_amount: new Prisma.Decimal(1000),
          items: [{ quantity: new Prisma.Decimal(2), unit_cost: new Prisma.Decimal(300) }], // returned cost = 600
        },
      ]);

      mockPrisma.damagedStock.findMany.mockResolvedValue([]);

      mockPrisma.expense.findMany.mockResolvedValue([
        { total_amount: new Prisma.Decimal(800) },
      ]);

      const profit = await reportService.getProfitReport(businessId, branch1Id, false, {});

      expect(profit.netSales).toBe('8500');
      expect(profit.costOfGoodsSold).toBe('5400');
      expect(profit.grossProfit).toBe('3100');
      expect(profit.expenses).toBe('800');
      expect(profit.netProfit).toBe('2300');
    });
  });
});
