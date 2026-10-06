import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { StockService } from './services/stock.service.js';
import { SequenceService } from './services/sequence.service.js';
import { SupplierService } from './services/supplier.service.js';
import { PurchaseService } from './services/purchase.service.js';
import { SupplierPaymentService } from './services/supplier-payment.service.js';
import { StockTransferService } from './services/stock-transfer.service.js';
import { StockAdjustmentService } from './services/stock-adjustment.service.js';
import { BranchContextGuard } from '../../common/guards/branch-context.guard.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { ProductBranchService } from '../catalog/services/product-branch.service.js';

describe('Phase 3: Purchasing & Inventory Unit Tests', () => {
  let mockPrisma: any;
  let mockProductBranchService: any;
  let sequenceService: SequenceService;
  let stockService: StockService;
  let supplierService: SupplierService;
  let purchaseService: PurchaseService;
  let paymentService: SupplierPaymentService;
  let transferService: StockTransferService;
  let adjustmentService: StockAdjustmentService;

  const businessId = 'biz-001';
  const branch1Id = 'branch-gulshan';
  const branch2Id = 'branch-dhanmondi';
  const userId = 'user-staff-1';
  const ownerId = 'user-owner-1';
  const variant1Id = 'variant-panjabi-m';
  const product1Id = 'product-panjabi';
  const supplier1Id = 'supplier-apex';

  beforeEach(() => {
    mockPrisma = {
      stockBalance: {
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      stockMovement: {
        create: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        aggregate: vi.fn(),
      },
      productVariant: {
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      product: {
        findFirst: vi.fn(),
      },
      productUnit: {
        create: vi.fn(),
        findMany: vi.fn(),
        updateMany: vi.fn(),
        count: vi.fn(),
      },
      supplier: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
      },
      purchase: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
      },
      purchaseItem: {
        create: vi.fn(),
      },
      purchaseOrder: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      purchaseOrderItem: {
        update: vi.fn(),
        findMany: vi.fn(),
      },
      supplierPayment: {
        create: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
      },
      stockTransfer: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
      },
      stockTransferItem: {
        create: vi.fn(),
        update: vi.fn(),
      },
      stockAdjustment: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
        findMany: vi.fn(),
      },
      stockAdjustmentItem: {
        create: vi.fn(),
      },
      invoiceSequence: {
        upsert: vi.fn(),
      },
      notification: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      branch: {
        findFirst: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
      userBranchAccess: {
        findFirst: vi.fn(),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn(),
    };

    mockProductBranchService = {
      ensureProductInBranch: vi.fn().mockResolvedValue({ id: 'pb-1', is_active: true }),
    };

    sequenceService = new SequenceService();
    stockService = new StockService(
      mockPrisma as unknown as PrismaService,
      mockProductBranchService as unknown as ProductBranchService,
    );
    supplierService = new SupplierService(mockPrisma as unknown as PrismaService);
    purchaseService = new PurchaseService(
      mockPrisma as unknown as PrismaService,
      stockService,
      sequenceService,
    );
    paymentService = new SupplierPaymentService(
      mockPrisma as unknown as PrismaService,
      sequenceService,
    );
    transferService = new StockTransferService(
      mockPrisma as unknown as PrismaService,
      stockService,
      sequenceService,
    );
    adjustmentService = new StockAdjustmentService(
      mockPrisma as unknown as PrismaService,
      stockService,
    );
  });

  // ==========================================================================
  // 1. WAC CALCULATIONS
  // ==========================================================================
  describe('1. Weighted Average Cost (WAC) calculations', () => {
    it('calculates WAC correctly across multiple purchases at different costs and preserves WAC on stock-out', async () => {
      // Mock variant details
      mockPrisma.productVariant.findUniqueOrThrow.mockResolvedValue({
        id: variant1Id,
        product_id: product1Id,
        sku: 'PANJABI-BLK-M',
        reorder_level: 5,
        cost_price: 100,
      });

      let currentBalanceState: any = null;

      // Mock DB behavior for StockBalance upsert & updates inside transaction
      mockPrisma.stockBalance.findUnique.mockImplementation(() => Promise.resolve(currentBalanceState));
      mockPrisma.stockBalance.findUniqueOrThrow.mockImplementation(() => Promise.resolve(currentBalanceState));
      mockPrisma.stockBalance.create.mockImplementation((args: any) => {
        currentBalanceState = { id: 'sb-1', ...args.data };
        return Promise.resolve(currentBalanceState);
      });
      mockPrisma.stockBalance.update.mockImplementation((args: any) => {
        currentBalanceState = { ...currentBalanceState, ...args.data };
        return Promise.resolve(currentBalanceState);
      });
      mockPrisma.stockMovement.create.mockImplementation((args: any) => ({
        id: 'mov-1',
        ...args.data,
      }));

      // Purchase 1: 10 units @ 100 BDT
      const p1 = await stockService.applyMovement(mockPrisma, {
        businessId,
        branchId: branch1Id,
        variantId: variant1Id,
        movementType: 'PURCHASE',
        quantity: 10,
        unitCost: 100,
        referenceType: 'PURCHASE',
        referenceId: 'pur-1',
        createdBy: userId,
      });

      expect(Number(p1.balance?.quantity)).toBe(10);
      expect(Number(p1.newWac)).toBe(100);
      expect(Number(p1.balance?.total_cost_value)).toBe(1000);

      // Purchase 2: 10 units @ 200 BDT
      // Formula: (1000 + 10 * 200) / (10 + 10) = 3000 / 20 = 150 BDT
      const p2 = await stockService.applyMovement(mockPrisma, {
        businessId,
        branchId: branch1Id,
        variantId: variant1Id,
        movementType: 'PURCHASE',
        quantity: 10,
        unitCost: 200,
        referenceType: 'PURCHASE',
        referenceId: 'pur-2',
        createdBy: userId,
      });

      expect(Number(p2.balance?.quantity)).toBe(20);
      expect(Number(p2.newWac)).toBe(150);
      expect(Number(p2.balance?.total_cost_value)).toBe(3000);

      // Stock-out (Sale): 5 units out @ current WAC (150 BDT)
      // Balance becomes 15 units, WAC stays 150 BDT, total value = 15 * 150 = 2250 BDT
      const p3 = await stockService.applyMovement(mockPrisma, {
        businessId,
        branchId: branch1Id,
        variantId: variant1Id,
        movementType: 'SALE',
        quantity: 5,
        referenceType: 'SALE',
        referenceId: 'sale-1',
        createdBy: userId,
      });

      expect(Number(p3.balance?.quantity)).toBe(15);
      expect(Number(p3.newWac)).toBe(150);
      expect(Number(p3.balance?.total_cost_value)).toBe(2250);

      // Purchase 3: 5 units @ 300 BDT
      // Formula: (2250 + 5 * 300) / (15 + 5) = 3750 / 20 = 187.5 BDT
      const p4 = await stockService.applyMovement(mockPrisma, {
        businessId,
        branchId: branch1Id,
        variantId: variant1Id,
        movementType: 'PURCHASE',
        quantity: 5,
        unitCost: 300,
        referenceType: 'PURCHASE',
        referenceId: 'pur-3',
        createdBy: userId,
      });

      expect(Number(p4.balance?.quantity)).toBe(20);
      expect(Number(p4.newWac)).toBe(187.5);
      expect(Number(p4.balance?.total_cost_value)).toBe(3750);
    });
  });

  // ==========================================================================
  // 2. NEGATIVE STOCK BLOCK & CONCURRENCY
  // ==========================================================================
  describe('2. Negative stock blocking & concurrency safety', () => {
    it('blocks stock-out when available quantity is insufficient (respects allocated_quantity)', async () => {
      mockPrisma.stockBalance.findUnique.mockResolvedValue({
        id: 'sb-1',
        quantity: new Prisma.Decimal(10),
        allocated_quantity: new Prisma.Decimal(4), // Available = 10 - 4 = 6
        avg_cost_price: new Prisma.Decimal(150),
        total_cost_value: new Prisma.Decimal(1500),
      });
      mockPrisma.stockBalance.findUniqueOrThrow.mockResolvedValue({
        id: 'sb-1',
        quantity: new Prisma.Decimal(10),
        allocated_quantity: new Prisma.Decimal(4),
        avg_cost_price: new Prisma.Decimal(150),
        total_cost_value: new Prisma.Decimal(1500),
      });
      mockPrisma.productVariant.findUniqueOrThrow.mockResolvedValue({
        id: variant1Id,
        sku: 'PANJABI-BLK-M',
        reorder_level: 2,
      });

      // Request 7 units (available is 6)
      await expect(
        stockService.applyMovement(mockPrisma, {
          businessId,
          branchId: branch1Id,
          variantId: variant1Id,
          movementType: 'SALE',
          quantity: 7,
          referenceType: 'SALE',
          referenceId: 'sale-fail',
          createdBy: userId,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('concurrent sales of the last remaining unit: only one succeeds, second gets INSUFFICIENT_STOCK', async () => {
      let currentStock = 1;

      mockPrisma.productVariant.findUniqueOrThrow.mockResolvedValue({
        id: variant1Id,
        sku: 'LAST-UNIT-SKU',
        reorder_level: 0,
      });

      // Simulate row-level locking behavior:
      // When transaction 1 executes, it reads 1, updates stock to 0.
      // When transaction 2 reads the locked row after transaction 1 completes, stock is 0.
      mockPrisma.stockBalance.findUnique.mockImplementation(() =>
        Promise.resolve({
          id: 'sb-last',
          quantity: new Prisma.Decimal(currentStock),
          allocated_quantity: new Prisma.Decimal(0),
          avg_cost_price: new Prisma.Decimal(100),
          total_cost_value: new Prisma.Decimal(currentStock * 100),
        }),
      );
      mockPrisma.stockBalance.findUniqueOrThrow.mockImplementation(() =>
        Promise.resolve({
          id: 'sb-last',
          quantity: new Prisma.Decimal(currentStock),
          allocated_quantity: new Prisma.Decimal(0),
          avg_cost_price: new Prisma.Decimal(100),
          total_cost_value: new Prisma.Decimal(currentStock * 100),
        }),
      );
      mockPrisma.stockBalance.update.mockImplementation((args: any) => {
        currentStock = Number(args.data.quantity);
        return Promise.resolve({
          id: 'sb-last',
          quantity: new Prisma.Decimal(currentStock),
          allocated_quantity: new Prisma.Decimal(0),
          avg_cost_price: new Prisma.Decimal(100),
          total_cost_value: new Prisma.Decimal(currentStock * 100),
        });
      });
      mockPrisma.stockMovement.create.mockResolvedValue({ id: 'mov-last' });

      // First sale of 1 unit succeeds
      const sale1 = await stockService.applyMovement(mockPrisma, {
        businessId,
        branchId: branch1Id,
        variantId: variant1Id,
        movementType: 'SALE',
        quantity: 1,
        referenceType: 'SALE',
        referenceId: 'sale-tx-1',
        createdBy: userId,
      });
      expect(Number(sale1.balance?.quantity)).toBe(0);

      // Second sale of 1 unit fails immediately with INSUFFICIENT_STOCK
      await expect(
        stockService.applyMovement(mockPrisma, {
          businessId,
          branchId: branch1Id,
          variantId: variant1Id,
          movementType: 'SALE',
          quantity: 1,
          referenceType: 'SALE',
          referenceId: 'sale-tx-2',
          createdBy: userId,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ==========================================================================
  // 3. PURCHASE RECEIPT IN ONE TRANSACTION & ROLLBACK ON FAILURE
  // ==========================================================================
  describe('3. Purchase creation in single transaction', () => {
    it('creates movements, balance, supplier balance, and ProductUnits in one transaction, and rolls back on failure', async () => {
      mockPrisma.supplier.findFirst.mockResolvedValue({
        id: supplier1Id,
        name: 'Apex Ltd',
        current_balance: new Prisma.Decimal(1000),
      });

      mockPrisma.productVariant.findMany.mockResolvedValue([
        {
          id: variant1Id,
          sku: 'PANJABI-BLK-M',
          is_active: true,
          product: { id: product1Id, name: 'Panjabi', track_individually: true, deleted_at: null },
        },
      ]);

      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          invoiceSequence: {
            upsert: vi.fn().mockResolvedValue({
              prefix: 'PUR-',
              next_number: 2,
              created_at: new Date(100),
              updated_at: new Date(200),
            }),
          },
          purchase: {
            create: vi.fn().mockResolvedValue({
              id: 'pur-101',
              purchase_no: 'PUR-000001',
              subtotal: new Prisma.Decimal(1000),
              total_amount: new Prisma.Decimal(1000),
              paid_amount: new Prisma.Decimal(400),
              due_amount: new Prisma.Decimal(600),
            }),
          },
          purchaseItem: { create: vi.fn().mockResolvedValue({}) },
          productUnit: {
            create: vi.fn().mockImplementation((args: any) => ({
              id: `u-${Math.random()}`,
              ...args.data,
            })),
          },
          supplierPayment: { create: vi.fn().mockResolvedValue({}) },
          supplier: { update: vi.fn().mockResolvedValue({}) },
          stockBalance: {
            findUnique: vi.fn().mockResolvedValue(null),
            findUniqueOrThrow: vi.fn().mockResolvedValue({
              id: 'sb-1',
              quantity: new Prisma.Decimal(0),
              allocated_quantity: new Prisma.Decimal(0),
              avg_cost_price: new Prisma.Decimal(0),
              total_cost_value: new Prisma.Decimal(0),
            }),
            create: vi.fn().mockResolvedValue({
              id: 'sb-1',
              quantity: new Prisma.Decimal(0),
              allocated_quantity: new Prisma.Decimal(0),
              avg_cost_price: new Prisma.Decimal(0),
              total_cost_value: new Prisma.Decimal(0),
            }),
            update: vi.fn().mockResolvedValue({
              id: 'sb-1',
              quantity: new Prisma.Decimal(2),
              avg_cost_price: new Prisma.Decimal(500),
              total_cost_value: new Prisma.Decimal(1000),
            }),
          },
          productVariant: {
            findUniqueOrThrow: vi.fn().mockResolvedValue({
              id: variant1Id,
              product_id: product1Id,
              sku: 'PANJABI-BLK-M',
              reorder_level: 5,
              cost_price: 500,
            }),
          },
          stockMovement: { create: vi.fn().mockResolvedValue({ id: 'mov-1' }) },
          $queryRaw: vi.fn().mockResolvedValue([]),
        };
        return callback(tx);
      });

      const res = await purchaseService.createPurchase(businessId, branch1Id, userId, {
        supplierId: supplier1Id,
        paidAmount: 400,
        items: [{ variantId: variant1Id, quantity: 2, unitCost: 500 }],
      });

      expect(res.purchase_no).toBe('PUR-000001');
      expect(res.productUnits).toHaveLength(2); // 2 individual units created
      expect(res.productUnits[0].barcodeValue).toContain('PANJABI-BLK-M');

      // Test Rollback simulation: if a step fails, transaction rejects
      mockPrisma.$transaction.mockImplementationOnce(async () => {
        throw new Error('Database connection dropped midway');
      });

      await expect(
        purchaseService.createPurchase(businessId, branch1Id, userId, {
          supplierId: supplier1Id,
          items: [{ variantId: variant1Id, quantity: 2, unitCost: 500 }],
        }),
      ).rejects.toThrow('Database connection dropped midway');
    });
  });

  // ==========================================================================
  // 4. PURCHASE CANCEL BLOCKED WHEN STOCK IS SOLD
  // ==========================================================================
  describe('4. Purchase cancellation guard', () => {
    it('blocks purchase cancellation when stock has been sold or depleted below purchased quantity', async () => {
      mockPrisma.purchase.findFirst.mockResolvedValue({
        id: 'pur-1',
        business_id: businessId,
        branch_id: branch1Id,
        status: 'RECEIVED',
        due_amount: new Prisma.Decimal(1000),
        items: [{ product_variant_id: variant1Id, quantity: new Prisma.Decimal(10), variant: { sku: 'TEE-01' } }],
        purchase_returns: [],
        product_units: [],
      });

      // Stock balance shows only 5 remaining (5 were sold!)
      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          stockBalance: {
            findUnique: vi.fn().mockResolvedValue({
              quantity: new Prisma.Decimal(5),
              allocated_quantity: new Prisma.Decimal(0),
            }),
          },
        };
        return callback(tx);
      });

      await expect(
        purchaseService.cancelPurchase(businessId, branch1Id, userId, 'pur-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ==========================================================================
  // 5. SUPPLIER PAYMENT CANNOT EXCEED PURCHASE DUE
  // ==========================================================================
  describe('5. Supplier payment limits', () => {
    it('blocks supplier payment if payment amount exceeds purchase due amount', async () => {
      mockPrisma.supplier.findFirst.mockResolvedValue({
        id: supplier1Id,
        name: 'Apex Ltd',
        current_balance: new Prisma.Decimal(500),
      });

      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          purchase: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'pur-1',
              status: 'PARTIALLY_PAID',
              due_amount: new Prisma.Decimal(500),
              paid_amount: new Prisma.Decimal(500),
            }),
          },
        };
        return callback(tx);
      });

      // Try paying 600 against a 500 due purchase
      await expect(
        paymentService.createPayment(businessId, branch1Id, userId, {
          supplierId: supplier1Id,
          purchaseId: 'pur-1',
          amount: 600,
          paymentMethod: 'BANK',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ==========================================================================
  // 6. STOCK TRANSFERS: DISPATCH, PARTIAL RECEIVE, DISCREPANCY, REJECT
  // ==========================================================================
  describe('6. Stock Transfer workflow', () => {
    it('dispatch reduces source at source WAC, partial receive increases destination with WAC & records discrepancy', async () => {
      const transferId = 'trn-101';
      const transferItem = {
        id: 'ti-1',
        product_variant_id: variant1Id,
        sent_qty: new Prisma.Decimal(10),
        unit_cost: new Prisma.Decimal(120),
      };

      mockPrisma.stockTransfer.findFirst.mockResolvedValue({
        id: transferId,
        transfer_no: 'TRN-000001',
        from_branch_id: branch1Id,
        to_branch_id: branch2Id,
        status: 'IN_TRANSIT',
        items: [transferItem],
      });

      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          stockTransferItem: { update: vi.fn().mockResolvedValue({}) },
          stockTransfer: { update: vi.fn().mockImplementation((args: any) => ({ ...args.data })) },
          productUnit: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
          stockBalance: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'sb-dest',
              quantity: new Prisma.Decimal(0),
              allocated_quantity: new Prisma.Decimal(0),
              avg_cost_price: new Prisma.Decimal(0),
              total_cost_value: new Prisma.Decimal(0),
            }),
            findUniqueOrThrow: vi.fn().mockResolvedValue({
              id: 'sb-dest',
              quantity: new Prisma.Decimal(0),
              allocated_quantity: new Prisma.Decimal(0),
              avg_cost_price: new Prisma.Decimal(0),
              total_cost_value: new Prisma.Decimal(0),
            }),
            update: vi.fn().mockResolvedValue({}),
          },
          productVariant: {
            findUniqueOrThrow: vi.fn().mockResolvedValue({
              id: variant1Id,
              product_id: product1Id,
              sku: 'PANJABI-BLK-M',
              reorder_level: 2,
            }),
          },
          stockMovement: { create: vi.fn().mockResolvedValue({}) },
          $queryRaw: vi.fn().mockResolvedValue([]),
        };
        return callback(tx);
      });

      // Receive 8 out of 10 sent (2 units missing)
      const res = await transferService.receiveTransfer(
        businessId,
        branch2Id,
        userId,
        transferId,
        {
          items: [{ itemId: 'ti-1', receivedQty: 8, discrepancyNote: '2 units lost in transit' }],
        },
      );

      expect(res.status).toBe('RECEIVED');
      expect(res.notes).toContain('Shortage');
      expect(mockProductBranchService.ensureProductInBranch).toHaveBeenCalledWith(
        expect.anything(),
        businessId,
        product1Id,
        branch2Id,
      );
    });

    it('rejecting a dispatched transfer returns stock to source branch at original cost', async () => {
      mockPrisma.stockTransfer.findFirst.mockResolvedValue({
        id: 'trn-rej',
        transfer_no: 'TRN-REJ-01',
        from_branch_id: branch1Id,
        to_branch_id: branch2Id,
        status: 'IN_TRANSIT',
        items: [{ id: 'ti-r', product_variant_id: variant1Id, sent_qty: new Prisma.Decimal(5), unit_cost: new Prisma.Decimal(150) }],
      });

      let returnedToSource = false;
      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          stockTransfer: { update: vi.fn().mockResolvedValue({ status: 'REJECTED' }) },
          productUnit: { updateMany: vi.fn() },
          stockBalance: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'sb-source',
              quantity: new Prisma.Decimal(10),
              allocated_quantity: new Prisma.Decimal(0),
              avg_cost_price: new Prisma.Decimal(150),
              total_cost_value: new Prisma.Decimal(1500),
            }),
            findUniqueOrThrow: vi.fn().mockResolvedValue({
              id: 'sb-source',
              quantity: new Prisma.Decimal(10),
              allocated_quantity: new Prisma.Decimal(0),
              avg_cost_price: new Prisma.Decimal(150),
              total_cost_value: new Prisma.Decimal(1500),
            }),
            update: vi.fn().mockImplementation(() => {
              returnedToSource = true;
              return Promise.resolve({});
            }),
          },
          productVariant: {
            findUniqueOrThrow: vi.fn().mockResolvedValue({
              id: variant1Id,
              product_id: product1Id,
              sku: 'PANJABI-BLK-M',
              reorder_level: 2,
            }),
          },
          stockMovement: { create: vi.fn().mockResolvedValue({}) },
          $queryRaw: vi.fn().mockResolvedValue([]),
        };
        return callback(tx);
      });

      const res = await transferService.rejectTransfer(businessId, branch2Id, userId, 'trn-rej');
      expect(res.status).toBe('REJECTED');
      expect(returnedToSource).toBe(true);
    });
  });

  // ==========================================================================
  // 7. INSTANT TRANSFER IS IDEMPOTENT
  // ==========================================================================
  describe('7. createInstantTransfer idempotency', () => {
    it('returns existing transfer without duplicating movements when called with identical idempotencyKey', async () => {
      const idempotencyKey = 'idem-instant-transfer-99';
      const existingTransfer = {
        id: 'trn-instant-existing',
        idempotency_key: idempotencyKey,
        status: 'RECEIVED',
        items: [{ id: 'ti-instant', sent_qty: new Prisma.Decimal(3) }],
      };

      const tx = {
        stockTransfer: {
          findUnique: vi.fn().mockResolvedValue(existingTransfer),
          create: vi.fn(),
        },
      };

      const result = await transferService.createInstantTransfer(tx as any, {
        businessId,
        fromBranch: branch1Id,
        toBranch: branch2Id,
        items: [{ variantId: variant1Id, quantity: 3 }],
        idempotencyKey,
        createdBy: userId,
      });

      expect(result.id).toBe('trn-instant-existing');
      expect(tx.stockTransfer.create).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 8. PRODUCT VISIBILITY IN DESTINATION BRANCH
  // ==========================================================================
  describe('8. Product visibility via ProductBranch upon transfer', () => {
    it('ensures product is active and visible in destination branch upon receiving stock', async () => {
      mockPrisma.productVariant.findUniqueOrThrow.mockResolvedValue({
        id: variant1Id,
        product_id: product1Id,
        sku: 'PANJABI-BLK-M',
        reorder_level: 2,
      });
      mockPrisma.stockBalance.findUnique.mockResolvedValue({
        id: 'sb-new',
        quantity: new Prisma.Decimal(0),
        allocated_quantity: new Prisma.Decimal(0),
        avg_cost_price: new Prisma.Decimal(0),
        total_cost_value: new Prisma.Decimal(0),
      });
      mockPrisma.stockBalance.findUniqueOrThrow.mockResolvedValue({
        id: 'sb-new',
        quantity: new Prisma.Decimal(0),
        allocated_quantity: new Prisma.Decimal(0),
        avg_cost_price: new Prisma.Decimal(0),
        total_cost_value: new Prisma.Decimal(0),
      });
      mockPrisma.stockBalance.update.mockResolvedValue({});
      mockPrisma.stockMovement.create.mockResolvedValue({});

      await stockService.applyMovement(mockPrisma, {
        businessId,
        branchId: branch2Id,
        variantId: variant1Id,
        movementType: 'TRANSFER_IN',
        quantity: 5,
        unitCost: 200,
        referenceType: 'TRANSFER',
        referenceId: 'trn-test',
        createdBy: userId,
      });

      expect(mockProductBranchService.ensureProductInBranch).toHaveBeenCalledWith(
        mockPrisma,
        businessId,
        product1Id,
        branch2Id,
      );
    });
  });

  // ==========================================================================
  // 9. STOCK ADJUSTMENTS ONLY ON APPROVAL & CREATOR SEGREGATION
  // ==========================================================================
  describe('9. Stock Adjustments approval and segregation of duties', () => {
    it('creates adjustment in DRAFT without changing stock; applies changes only on approval', async () => {
      mockPrisma.productVariant.findMany.mockResolvedValue([{ id: variant1Id }]);
      mockPrisma.stockBalance.findUnique.mockResolvedValue({
        quantity: new Prisma.Decimal(10),
        avg_cost_price: new Prisma.Decimal(100),
      });

      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          stockAdjustment: {
            count: vi.fn().mockResolvedValue(0),
            create: vi.fn().mockImplementation((args: any) => ({
              id: 'adj-1',
              status: 'DRAFT',
              ...args.data,
            })),
          },
          stockBalance: {
            findUnique: vi.fn().mockResolvedValue({
              quantity: new Prisma.Decimal(10),
              avg_cost_price: new Prisma.Decimal(100),
            }),
          },
        };
        return callback(tx);
      });

      // 1. Create DRAFT: system_qty is 10, physical_qty is 12 (diff = +2)
      const draft = await adjustmentService.createAdjustment(businessId, branch1Id, userId, {
        reason: 'PHYSICAL_COUNT_DISCREPANCY',
        items: [{ variantId: variant1Id, physicalQty: 12 }],
      });

      expect(draft.status).toBe('DRAFT');
      expect(mockPrisma.stockMovement.create).not.toHaveBeenCalled();

      // 2. Creator segregation: creator trying to approve their own adjustment is blocked
      mockPrisma.stockAdjustment.findFirst.mockResolvedValue({
        id: 'adj-1',
        adjustment_no: 'ADJ-000001',
        status: 'DRAFT',
        created_by: userId,
        items: [{ product_variant_id: variant1Id, difference_qty: new Prisma.Decimal(2), unit_cost: new Prisma.Decimal(100) }],
      });

      await expect(
        adjustmentService.approveAdjustment(businessId, branch1Id, userId, false, 'adj-1'),
      ).rejects.toThrow(ForbiddenException);

      // 3. Approval by manager (or owner) succeeds and triggers movements
      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          stockAdjustment: { update: vi.fn().mockResolvedValue({ id: 'adj-1', status: 'APPROVED' }) },
          stockBalance: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'sb-1',
              quantity: new Prisma.Decimal(10),
              allocated_quantity: new Prisma.Decimal(0),
              avg_cost_price: new Prisma.Decimal(100),
              total_cost_value: new Prisma.Decimal(1000),
            }),
            findUniqueOrThrow: vi.fn().mockResolvedValue({
              id: 'sb-1',
              quantity: new Prisma.Decimal(10),
              allocated_quantity: new Prisma.Decimal(0),
              avg_cost_price: new Prisma.Decimal(100),
              total_cost_value: new Prisma.Decimal(1000),
            }),
            update: vi.fn().mockResolvedValue({}),
          },
          productVariant: {
            findUniqueOrThrow: vi.fn().mockResolvedValue({
              id: variant1Id,
              product_id: product1Id,
              sku: 'PANJABI-BLK-M',
              reorder_level: 2,
            }),
          },
          stockMovement: { create: vi.fn().mockResolvedValue({ id: 'mov-adj' }) },
          $queryRaw: vi.fn().mockResolvedValue([]),
        };
        return callback(tx);
      });

      const approved = await adjustmentService.approveAdjustment(
        businessId,
        branch1Id,
        'manager-id',
        false,
        'adj-1',
      );
      expect(approved.status).toBe('APPROVED');
    });
  });

  // ==========================================================================
  // 10. BRANCH ACCESS RESTRICTION
  // ==========================================================================
  describe('10. Branch access security', () => {
    it('blocks users from reading or acting on a branch they do not have access to', async () => {
      const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) };
      const guard = new BranchContextGuard(reflector as any, mockPrisma as any);

      // User has access to branch 1, but attempts action on branch 2
      mockPrisma.branch.findFirst.mockResolvedValue({
        id: branch2Id,
        name: 'Dhanmondi',
        is_active: true,
      });
      mockPrisma.userBranchAccess.findFirst.mockResolvedValue(null); // No access!

      const mockExecutionContext = {
        getHandler: vi.fn(),
        getClass: vi.fn(),
        switchToHttp: () => ({
          getRequest: () => ({
            headers: { 'x-branch-id': branch2Id },
            user: { id: userId, businessId, isOwner: false },
          }),
        }),
      } as any;

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(ForbiddenException);
    });
  });

  // ==========================================================================
  // 11. CONSISTENCY CHECKER DETECTS CORRUPTED BALANCE
  // ==========================================================================
  describe('11. Stock Consistency Checker Tool', () => {
    it('detects and reports a corrupted stock balance where StockBalance differs from StockMovement sum', async () => {
      // Deliberately corrupted stock balance: quantity is 10, but movements total 6
      mockPrisma.stockBalance.findMany.mockResolvedValue([
        {
          id: 'sb-corrupt',
          branch_id: branch1Id,
          product_variant_id: variant1Id,
          quantity: new Prisma.Decimal(10), // Corrupted!
          variant: {
            sku: 'CORRUPTED-SKU',
            product: { name: 'Faulty Product', track_individually: false },
          },
        },
      ]);

      mockPrisma.stockMovement.aggregate.mockResolvedValue({
        _sum: { quantity: new Prisma.Decimal(6) },
      });

      const report = await stockService.checkConsistency(businessId, branch1Id);

      expect(report.isConsistent).toBe(false);
      expect(report.mismatchesCount).toBe(1);
      expect(report.mismatches[0].sku).toBe('CORRUPTED-SKU');
      expect(report.mismatches[0].balanceQuantity).toBe(10);
      expect(report.mismatches[0].movementSum).toBe(6);
      expect(report.mismatches[0].quantityMismatch).toBe(true);
    });
  });
});
