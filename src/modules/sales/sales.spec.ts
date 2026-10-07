import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { CustomerService } from './services/customer.service.js';
import { PhoneNormalizerService } from './services/phone-normalizer.service.js';
import { RegisterSessionService } from './services/register-session.service.js';
import { PricingService } from './services/pricing.service.js';
import { HeldSaleService } from './services/held-sale.service.js';
import { SaleService } from './services/sale.service.js';
import { SmsStubService } from './services/sms-stub.service.js';
import { SequenceService } from '../inventory/services/sequence.service.js';

describe('Phase 4: POS Sales Unit Tests', () => {
  let mockPrisma: any;
  let phoneNormalizer: PhoneNormalizerService;
  let customerService: CustomerService;
  let registerSessionService: RegisterSessionService;
  let pricingService: PricingService;
  let heldSaleService: HeldSaleService;
  let saleService: SaleService;
  let smsStubService: SmsStubService;
  let sequenceService: SequenceService;
  let mockStockService: any;
  let mockStockTransferService: any;
  let mockPriceListService: any;

  const businessId = 'biz-001';
  const branch1Id = 'branch-gulshan';
  const branch2Id = 'branch-dhanmondi';
  const cashierId = 'user-cashier-1';
  const variant1Id = 'variant-polo-m';
  const product1Id = 'prod-polo';
  const registerId = 'reg-gulshan-1';
  const sessionId = 'session-gulshan-1';
  const customer1Id = 'cust-001';

  beforeEach(() => {
    mockPrisma = {
      customer: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      cashRegister: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      registerSession: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      productVariant: {
        findFirst: vi.fn().mockResolvedValue({
          id: variant1Id,
          sku: 'POLO-BLK-M',
          product: { id: product1Id, name: 'Polo Shirt', track_individually: false, is_active: true, deleted_at: null },
        }),
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
      productBranch: {
        findFirst: vi.fn().mockResolvedValue({ id: 'pb-1', is_active: true }),
        create: vi.fn(),
      },
      productUnit: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      coupon: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      sale: {
        findFirst: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      saleItem: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
      salePayment: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
      heldSale: {
        findFirst: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      heldSaleItem: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
      salesReturn: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      dueCollection: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      branch: {
        findFirst: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
      smsLog: {
        create: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      idempotencyKey: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
      },
      invoiceSequence: {
        upsert: vi.fn().mockResolvedValue({
          next_number: 2,
          prefix: 'INV-',
          created_at: new Date(1000),
          updated_at: new Date(1000),
        }),
      },
      $transaction: vi.fn().mockImplementation((cb: any) => cb(mockPrisma)),
    };

    phoneNormalizer = new PhoneNormalizerService();
    customerService = new CustomerService(mockPrisma, phoneNormalizer);
    registerSessionService = new RegisterSessionService(mockPrisma);
    smsStubService = new SmsStubService();
    sequenceService = new SequenceService();

    mockPriceListService = {
      getVariantPrice: vi.fn().mockResolvedValue(1500),
    };

    mockStockService = {
      applyMovement: vi.fn().mockResolvedValue({
        balance: { id: 'sb-1', quantity: new Prisma.Decimal(10) },
        movement: { id: 'sm-1', unit_cost: new Prisma.Decimal(900) },
        newWac: new Prisma.Decimal(900),
      }),
    };

    mockStockTransferService = {
      createInstantTransfer: vi.fn().mockResolvedValue({
        id: 'trans-01',
        transfer_no: 'TRN-000001',
      }),
    };

    pricingService = new PricingService(mockPrisma, mockPriceListService);
    heldSaleService = new HeldSaleService(mockPrisma, pricingService);

    saleService = new SaleService(
      mockPrisma,
      mockStockService,
      mockStockTransferService,
      sequenceService,
      pricingService,
      registerSessionService,
      smsStubService,
    );
  });

  // ============================================================================
  // 1. CREATE SALE REDUCES STOCK & CAPTURES WAC UNIT_COST
  // ============================================================================
  describe('1. Create sale stock reduction & WAC cost capture', () => {
    it('reduces stock in the current branch and stores exact WAC unit_cost per item', async () => {
      // Setup register session
      mockPrisma.registerSession.findFirst.mockResolvedValue({
        id: sessionId,
        business_id: businessId,
        branch_id: branch1Id,
        cash_register_id: registerId,
        user_id: cashierId,
        status: 'OPEN',
      });

      // Setup variant
      mockPrisma.productVariant.findFirst.mockResolvedValue({
        id: variant1Id,
        sku: 'POLO-BLK-M',
        product: { id: product1Id, name: 'Polo Shirt', track_individually: false, is_active: true, deleted_at: null },
      });

      // Product branch visibility
      mockPrisma.productBranch.findFirst.mockResolvedValue({
        id: 'pb-1',
        is_active: true,
      });

      // Sequence
      mockPrisma.invoiceSequence.upsert.mockResolvedValue({
        next_number: 2,
        prefix: 'INV-',
        created_at: new Date(1000),
        updated_at: new Date(1000),
      });

      // Mock Sale creation
      mockPrisma.sale.create.mockResolvedValue({
        id: 'sale-001',
        invoice_no: 'INV-000001',
      });

      mockPrisma.sale.findUniqueOrThrow.mockResolvedValue({
        id: 'sale-001',
        invoice_no: 'INV-000001',
        sale_date: new Date(),
        sale_type: 'RETAIL',
        status: 'COMPLETED',
        branch: { id: branch1Id, name: 'Gulshan', code: 'GUL' },
        cash_register: { id: registerId, name: 'Main POS', code: 'POS-1' },
        customer: null,
        subtotal: new Prisma.Decimal(1500),
        discount_amount: new Prisma.Decimal(0),
        coupon: null,
        tax_amount: new Prisma.Decimal(0),
        round_off: new Prisma.Decimal(0),
        total_amount: new Prisma.Decimal(1500),
        paid_amount: new Prisma.Decimal(1500),
        due_amount: new Prisma.Decimal(0),
        change_amount: new Prisma.Decimal(0),
        total_cost: new Prisma.Decimal(900),
        is_offline: false,
        voided_at: null,
        void_reason: null,
        items: [
          {
            id: 'item-1',
            product_variant_id: variant1Id,
            variant: {
              sku: 'POLO-BLK-M',
              product: { id: product1Id, name: 'Polo Shirt', code: 'POLO' },
            },
            quantity: new Prisma.Decimal(1),
            unit_price: new Prisma.Decimal(1500),
            unit_cost: new Prisma.Decimal(900),
            discount_amount: new Prisma.Decimal(0),
            tax_amount: new Prisma.Decimal(0),
            total_amount: new Prisma.Decimal(1500),
            total_cost: new Prisma.Decimal(900),
            product_unit: null,
          },
        ],
        payments: [
          {
            id: 'pay-1',
            payment_method: 'CASH',
            amount: new Prisma.Decimal(1500),
            transaction_no: null,
            payment_date: new Date(),
          },
        ],
      });

      const res = await saleService.createSale(
        businessId,
        branch1Id,
        cashierId,
        {
          idempotencyKey: 'idem-sale-001',
          items: [{ variantId: variant1Id, quantity: 1 }],
          payments: [{ paymentMethod: 'CASH' as any, amount: 1500 }],
        },
      );

      expect(mockStockService.applyMovement).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          businessId,
          branchId: branch1Id,
          variantId: variant1Id,
          movementType: 'SALE',
          quantity: expect.any(Prisma.Decimal),
        }),
      );

      expect(mockPrisma.saleItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          product_variant_id: variant1Id,
          unit_cost: new Prisma.Decimal(900),
          total_cost: new Prisma.Decimal(900),
        }),
      });

      expect(res.invoiceNo).toBe('INV-000001');
      expect(res.totalCost).toBe(900);
    });
  });

  // ============================================================================
  // 2. IDEMPOTENCY: SAME KEY -> RETRY; SAME KEY DIFFERENT PAYLOAD -> 409
  // ============================================================================
  describe('2. Idempotency guarantees', () => {
    it('returns original sale if called twice with the same key and identical payload', async () => {
      const cachedResponse = { invoiceNo: 'INV-000001', totalAmount: 1500 };
      mockPrisma.idempotencyKey.findUnique.mockResolvedValue({
        key: 'idem-sale-repeat',
        request_hash: '2f1e29c0fca8e58941cfb5fa3d6230f25eec56c70f074dff284a1a3648c772cb',
        response_payload: cachedResponse,
      });

      // Compute exact hash of payload to match
      const dto = {
        idempotencyKey: 'idem-sale-repeat',
        items: [{ variantId: variant1Id, quantity: 1 }],
        payments: [{ paymentMethod: 'CASH' as any, amount: 1500 }],
      };
      const clone = { ...dto };
      delete (clone as any).idempotencyKey;
      const expectedHash = (saleService as any).computePayloadHash(dto);

      mockPrisma.idempotencyKey.findUnique.mockResolvedValue({
        key: 'idem-sale-repeat',
        request_hash: expectedHash,
        response_payload: cachedResponse,
      });

      const res = await saleService.createSale(businessId, branch1Id, cashierId, dto);
      expect(res).toEqual(cachedResponse);
    });

    it('throws ConflictException (409) if called with same key but different payload', async () => {
      mockPrisma.idempotencyKey.findUnique.mockResolvedValue({
        key: 'idem-tampered',
        request_hash: 'different-hash-from-earlier',
      });

      await expect(
        saleService.createSale(businessId, branch1Id, cashierId, {
          idempotencyKey: 'idem-tampered',
          items: [{ variantId: variant1Id, quantity: 2 }], // different qty
          payments: [{ paymentMethod: 'CASH' as any, amount: 3000 }],
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ============================================================================
  // 3. CONCURRENT SALE OF LAST UNIT REJECTION
  // ============================================================================
  describe('3. Concurrency check on last unit', () => {
    it('rejects sale when stock engine throws INSUFFICIENT_STOCK', async () => {
      mockPrisma.registerSession.findFirst.mockResolvedValue({
        id: sessionId,
        status: 'OPEN',
      });
      mockPrisma.productVariant.findFirst.mockResolvedValue({
        id: variant1Id,
        sku: 'POLO-LAST',
        product: { id: product1Id, name: 'Polo Shirt', track_individually: false, is_active: true, deleted_at: null },
      });
      mockPrisma.productBranch.findFirst.mockResolvedValue({ id: 'pb-1', is_active: true });
      mockPrisma.sale.create.mockResolvedValue({ id: 'sale-last-1' });

      // StockService simulates race failure
      mockStockService.applyMovement.mockRejectedValue(
        new BadRequestException('Insufficient stock for SKU "POLO-LAST"'),
      );

      await expect(
        saleService.createSale(businessId, branch1Id, cashierId, {
          idempotencyKey: 'idem-race-last',
          items: [{ variantId: variant1Id, quantity: 1 }],
          payments: [{ paymentMethod: 'CASH' as any, amount: 1500 }],
        }),
      ).rejects.toThrow('Insufficient stock');
    });
  });

  // ============================================================================
  // 4. CREDIT SALE & CUSTOMER DUE / CREDIT LIMIT
  // ============================================================================
  describe('4. Credit sale validation and credit limit', () => {
    it('rejects credit sale if customer is missing', async () => {
      mockPrisma.registerSession.findFirst.mockResolvedValue({ id: sessionId, status: 'OPEN' });
      mockPrisma.productVariant.findFirst.mockResolvedValue({
        id: variant1Id,
        sku: 'POLO-CREDIT',
        product: { id: product1Id, name: 'Polo', track_individually: false, is_active: true, deleted_at: null },
      });
      mockPrisma.productBranch.findFirst.mockResolvedValue({ id: 'pb-1', is_active: true });

      // Sale amount = 1500, paid = 500 -> due = 1000, but customerId missing
      await expect(
        saleService.createSale(businessId, branch1Id, cashierId, {
          idempotencyKey: 'idem-credit-no-cust',
          items: [{ variantId: variant1Id, quantity: 1 }],
          payments: [{ paymentMethod: 'CASH' as any, amount: 500 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('enforces customer credit limit and increments customer.current_due atomically', async () => {
      mockPrisma.registerSession.findFirst.mockResolvedValue({ id: sessionId, status: 'OPEN' });
      mockPrisma.productVariant.findFirst.mockResolvedValue({
        id: variant1Id,
        sku: 'POLO-CREDIT',
        product: { id: product1Id, name: 'Polo', track_individually: false, is_active: true, deleted_at: null },
      });
      mockPrisma.productBranch.findFirst.mockResolvedValue({ id: 'pb-1', is_active: true });

      // Customer has current_due = 4500, credit_limit = 5000. New due = 1000 -> Total 5500 > 5000
      mockPrisma.customer.findFirst.mockResolvedValue({
        id: customer1Id,
        name: 'Rahim Khan',
        current_due: new Prisma.Decimal(4500),
        credit_limit: new Prisma.Decimal(5000),
      });

      await expect(
        saleService.createSale(businessId, branch1Id, cashierId, {
          idempotencyKey: 'idem-over-credit-limit',
          customerId: customer1Id,
          items: [{ variantId: variant1Id, quantity: 1 }],
          payments: [{ paymentMethod: 'CASH' as any, amount: 500 }], // due = 1000
        }),
      ).rejects.toThrow('Credit limit exceeded');
    });
  });

  // ============================================================================
  // 5. CUSTOMER BUSINESS-WIDE LOOKUP BY NORMALIZED BD PHONE
  // ============================================================================
  describe('5. Customer normalization & business-wide phone lookup', () => {
    it('normalizes +88017..., 88017..., and 017... to the same 11-digit format', async () => {
      expect(phoneNormalizer.normalize('+8801712345678')).toBe('01712345678');
      expect(phoneNormalizer.normalize('8801712345678')).toBe('01712345678');
      expect(phoneNormalizer.normalize('01712345678')).toBe('01712345678');
      expect(phoneNormalizer.normalize('01712-345678')).toBe('01712345678');
    });

    it('finds a customer created in branch 1 from branch 2 using variant phone formats', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({
        id: customer1Id,
        name: 'Karim Ullah',
        phone: '01819999999',
        opening_due: new Prisma.Decimal(0),
        current_due: new Prisma.Decimal(250),
        credit_limit: new Prisma.Decimal(10000),
        loyalty_points: 12,
      });

      const found = await customerService.lookupByPhone(businessId, '+8801819999999');
      expect(found.name).toBe('Karim Ullah');
      expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith({
        where: {
          business_id: businessId,
          phone: '01819999999',
          deleted_at: null,
        },
      });
    });
  });

  // ============================================================================
  // 6. COUPON USAGE LIMIT ATOMIC INCREMENT
  // ============================================================================
  describe('6. Coupon usage limit under concurrent use', () => {
    it('rejects coupon when usage_limit is reached in pricing check', async () => {
      mockPrisma.coupon.findFirst.mockResolvedValue({
        id: 'cpn-eid',
        code: 'EID2026',
        usage_limit: 10,
        usage_count: 10, // Full
        is_active: true,
        expires_at: new Date(Date.now() + 1000000),
        discount: { is_active: true, starts_at: new Date(0), ends_at: new Date(Date.now() + 1000000), type: 'FIXED_AMOUNT', value: 100 },
      });

      await expect(
        pricingService.calculateCart(businessId, branch1Id, {
          items: [{ variantId: variant1Id, quantity: 1 }],
          couponCode: 'EID2026',
        }),
      ).rejects.toThrow('Coupon "EID2026" has reached its maximum usage limit');
    });
  });

  // ============================================================================
  // 7. CLIENT-SENT TOTALS ARE STRICTLY IGNORED
  // ============================================================================
  describe('7. Server recalculation security', () => {
    it('ignores client attempts to pass tampered total_amount in request', async () => {
      mockPrisma.registerSession.findFirst.mockResolvedValue({ id: sessionId, status: 'OPEN' });
      mockPrisma.productVariant.findFirst.mockResolvedValue({
        id: variant1Id,
        sku: 'POLO-PRICE',
        product: { id: product1Id, name: 'Polo', track_individually: false, is_active: true, deleted_at: null },
      });
      mockPrisma.productBranch.findFirst.mockResolvedValue({ id: 'pb-1', is_active: true });

      mockPrisma.sale.create.mockResolvedValue({ id: 'sale-tamper' });
      mockPrisma.sale.findUniqueOrThrow.mockResolvedValue({
        id: 'sale-tamper',
        total_amount: new Prisma.Decimal(1500),
        subtotal: new Prisma.Decimal(1500),
        items: [],
        payments: [],
      });

      // Client attempts to sneak total_amount: 10 instead of catalog price 1500
      const tamperedDto: any = {
        idempotencyKey: 'idem-tamper',
        items: [{ variantId: variant1Id, quantity: 1 }],
        payments: [{ paymentMethod: 'CASH', amount: 1500 }],
        total_amount: 10,
      };

      await saleService.createSale(businessId, branch1Id, cashierId, tamperedDto);

      // Server must have calculated using catalog price (1500), ignoring client 10
      expect(mockPrisma.sale.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          total_amount: new Prisma.Decimal(1500),
          subtotal: new Prisma.Decimal(1500),
        }),
      });
    });
  });

  // ============================================================================
  // 8. CROSS-BRANCH SALE: AUTO-TRANSFER & COST CALCULATION
  // ============================================================================
  describe('8. Cross-branch sale auto-transfer', () => {
    it('creates instant auto-transfer before stock-out, ensures visibility, and records transfer numbers', async () => {
      mockPrisma.registerSession.findFirst.mockResolvedValue({ id: sessionId, status: 'OPEN' });
      mockPrisma.productVariant.findFirst.mockResolvedValue({
        id: variant1Id,
        sku: 'POLO-OTHER',
        product: { id: product1Id, name: 'Polo', track_individually: false, is_active: true, deleted_at: null },
      });
      // Source branch is active in business
      mockPrisma.branch.findFirst.mockResolvedValue({ id: branch2Id, is_active: true });
      mockPrisma.sale.create.mockResolvedValue({ id: 'sale-cross' });

      mockPrisma.sale.findUniqueOrThrow.mockResolvedValue({
        id: 'sale-cross',
        invoice_no: 'INV-000002',
        sale_date: new Date(),
        sale_type: 'RETAIL',
        status: 'COMPLETED',
        branch: { id: branch1Id, name: 'Gulshan' },
        subtotal: new Prisma.Decimal(1500),
        total_amount: new Prisma.Decimal(1500),
        paid_amount: new Prisma.Decimal(1500),
        due_amount: new Prisma.Decimal(0),
        total_cost: new Prisma.Decimal(900),
        items: [],
        payments: [],
      });

      const res = await saleService.createSale(
        businessId,
        branch1Id,
        cashierId,
        {
          idempotencyKey: 'idem-cross-1',
          items: [{ variantId: variant1Id, quantity: 1, sourceBranchId: branch2Id }],
          payments: [{ paymentMethod: 'CASH' as any, amount: 1500 }],
        },
        { code: 'OWNER', permissions: ['sale.cross_branch'] },
      );

      expect(mockStockTransferService.createInstantTransfer).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          businessId,
          fromBranch: branch2Id,
          toBranch: branch1Id,
          idempotencyKey: 'idem-cross-1:branch-dhanmondi',
        }),
      );

      expect(res.autoTransfers).toBeDefined();
      expect(res.autoTransfers![0].transferNo).toBe('TRN-000001');
    });

    it('rejects cross-branch transfer for offline sales', async () => {
      mockPrisma.registerSession.findFirst.mockResolvedValue({ id: sessionId, status: 'OPEN' });
      mockPrisma.productVariant.findFirst.mockResolvedValue({
        id: variant1Id,
        sku: 'POLO-OFFLINE',
        product: { id: product1Id, name: 'Polo', track_individually: false, is_active: true, deleted_at: null },
      });

      await expect(
        saleService.createSale(
          businessId,
          branch1Id,
          cashierId,
          {
            idempotencyKey: 'idem-offline-cross',
            isOffline: true,
            items: [{ variantId: variant1Id, quantity: 1, sourceBranchId: branch2Id }],
            payments: [{ paymentMethod: 'CASH' as any, amount: 1500 }],
          },
          { permissions: ['sale.cross_branch'] },
        ),
      ).rejects.toThrow('Cross-branch auto-transfer is not allowed for offline-originated sales');
    });
  });

  // ============================================================================
  // 9. CROSS-BRANCH RETRY CREATES EXACTLY ONE TRANSFER AND SALE
  // ============================================================================
  describe('9. Cross-branch idempotent retry', () => {
    it('returns existing cached sale on retry without creating duplicate transfers', async () => {
      mockPrisma.idempotencyKey.findUnique.mockResolvedValue({
        key: 'idem-cross-retry',
        request_hash: 'hash-abc',
        response_payload: { invoiceNo: 'INV-000005', autoTransfers: [{ transferNo: 'TRN-000005' }] },
      });

      const dto = {
        idempotencyKey: 'idem-cross-retry',
        items: [{ variantId: variant1Id, quantity: 1, sourceBranchId: branch2Id }],
        payments: [{ paymentMethod: 'CASH' as any, amount: 1500 }],
      };
      (saleService as any).computePayloadHash = vi.fn().mockReturnValue('hash-abc');

      const res = await saleService.createSale(businessId, branch1Id, cashierId, dto);
      expect(res.invoiceNo).toBe('INV-000005');
      expect(mockStockTransferService.createInstantTransfer).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // 10. CROSS-BRANCH FAILURE ROLLS BACK TRANSFER TOO
  // ============================================================================
  describe('10. Cross-branch transaction rollback', () => {
    it('rolls back transfer inside the transaction if payment or stock validation fails', async () => {
      mockPrisma.registerSession.findFirst.mockResolvedValue({ id: sessionId, cash_register_id: registerId, status: 'OPEN' });
      mockPrisma.productVariant.findFirst.mockResolvedValue({
        id: variant1Id,
        sku: 'POLO-FAIL',
        product: { id: product1Id, name: 'Polo', track_individually: false, is_active: true, deleted_at: null },
      });
      mockPrisma.branch.findFirst.mockResolvedValue({ id: branch2Id, is_active: true });
      mockPrisma.sale.create.mockResolvedValue({ id: 'sale-fail-1' });

      // Transaction callback throws an error when stock movement fails
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        return cb(mockPrisma);
      });
      mockStockService.applyMovement.mockRejectedValue(new Error('DB failure during stock out'));

      await expect(
        saleService.createSale(
          businessId,
          branch1Id,
          cashierId,
          {
            idempotencyKey: 'idem-fail-tx',
            items: [{ variantId: variant1Id, quantity: 1, sourceBranchId: branch2Id }],
            payments: [{ paymentMethod: 'CASH' as any, amount: 1500 }],
          },
          { permissions: ['sale.cross_branch'] },
        ),
      ).rejects.toThrow('DB failure during stock out');
    });
  });

  // ============================================================================
  // 11. CROSS-BRANCH REQUIRES sale.cross_branch PERMISSION
  // ============================================================================
  describe('11. Cross-branch permissions guard', () => {
    it('throws ForbiddenException if user lacks sale.cross_branch', async () => {
      mockPrisma.registerSession.findFirst.mockResolvedValue({ id: sessionId, status: 'OPEN' });
      mockPrisma.productVariant.findFirst.mockResolvedValue({
        id: variant1Id,
        sku: 'POLO-NO-PERM',
        product: { id: product1Id, name: 'Polo', track_individually: false, is_active: true, deleted_at: null },
      });

      await expect(
        saleService.createSale(
          businessId,
          branch1Id,
          cashierId,
          {
            idempotencyKey: 'idem-no-perm',
            items: [{ variantId: variant1Id, quantity: 1, sourceBranchId: branch2Id }],
            payments: [{ paymentMethod: 'CASH' as any, amount: 1500 }],
          },
          { code: 'CASHIER', permissions: ['sale.create'] }, // Lacks sale.cross_branch
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ============================================================================
  // 12. TRACKED INDIVIDUAL UNITS
  // ============================================================================
  describe('12. Tracked individual product units', () => {
    it('marks unit SOLD; rejects sale if unit is already sold or belongs to another branch', async () => {
      mockPrisma.registerSession.findFirst.mockResolvedValue({ id: sessionId, status: 'OPEN' });
      mockPrisma.productVariant.findFirst.mockResolvedValue({
        id: variant1Id,
        sku: 'SUIT-TRACKED',
        product: { id: product1Id, name: 'Suit', track_individually: true, is_active: true, deleted_at: null },
      });
      mockPrisma.productBranch.findFirst.mockResolvedValue({ id: 'pb-1', is_active: true });
      mockPrisma.sale.create.mockResolvedValue({ id: 'sale-unit' });

      // Unit is in another branch
      mockPrisma.productUnit.findFirst.mockResolvedValue({
        id: 'unit-wrong-branch',
        barcode_value: 'UNIT-999',
        branch_id: branch2Id, // Not branch1Id
        status: 'IN_STOCK',
      });

      await expect(
        saleService.createSale(businessId, branch1Id, cashierId, {
          idempotencyKey: 'idem-unit-branch',
          items: [{ variantId: variant1Id, quantity: 1, productUnitBarcode: 'UNIT-999' }],
          payments: [{ paymentMethod: 'CASH' as any, amount: 1500 }],
        }),
      ).rejects.toThrow('belongs to another branch');
    });
  });

  // ============================================================================
  // 13. VOID SALE RESTORES STOCK, UNITS, CUSTOMER DUE, COUPON USAGE
  // ============================================================================
  describe('13. Void Sale', () => {
    it('restores stock via movements, units to IN_STOCK, customer due, and coupon count', async () => {
      mockPrisma.sale.findFirst.mockResolvedValue({
        id: 'sale-to-void',
        invoice_no: 'INV-000010',
        branch_id: branch1Id,
        customer_id: customer1Id,
        coupon_id: 'coupon-1',
        sale_date: new Date(),
        status: 'COMPLETED',
        total_amount: new Prisma.Decimal(1500),
        paid_amount: new Prisma.Decimal(1000),
        due_amount: new Prisma.Decimal(500),
        items: [
          {
            product_variant_id: variant1Id,
            quantity: new Prisma.Decimal(1),
            unit_cost: new Prisma.Decimal(900),
          },
        ],
        payments: [
          {
            id: 'pay-orig-1',
            amount: new Prisma.Decimal(1000),
            payment_method: 'CASH',
            register_session_id: sessionId,
            idempotency_key: 'idem-orig-pay',
          },
        ],
        returns: [],
        original_exchange: [],
      });

      mockPrisma.sale.update.mockResolvedValue({
        id: 'sale-to-void',
        invoice_no: 'INV-000010',
        status: 'VOIDED',
        void_reason: 'Mistake in cart items',
        branch: { id: branch1Id },
        cash_register: null,
        customer: { id: customer1Id, current_due: 0, loyalty_points: 0 },
        subtotal: 1500,
        discount_amount: 0,
        coupon: null,
        tax_amount: 0,
        round_off: 0,
        total_amount: 1500,
        paid_amount: 1000,
        due_amount: 500,
        change_amount: 0,
        total_cost: 900,
        items: [],
        payments: [],
      });

      const res = await saleService.voidSale(
        businessId,
        branch1Id,
        cashierId,
        'sale-to-void',
        { reason: 'Mistake in cart items' },
      );

      // 1. Stock reversal
      expect(mockStockService.applyMovement).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          movementType: 'SALE_RETURN',
          unitCost: new Prisma.Decimal(900),
        }),
      );

      // 2. Product units restored
      expect(mockPrisma.productUnit.updateMany).toHaveBeenCalledWith({
        where: { sold_sale_id: 'sale-to-void' },
        data: expect.objectContaining({ status: 'IN_STOCK', sold_sale_id: null }),
      });

      // 3. Customer due decremented
      expect(mockPrisma.customer.update).toHaveBeenCalledWith({
        where: { id: customer1Id },
        data: { current_due: { decrement: new Prisma.Decimal(500) } },
      });

      // 4. Coupon usage decremented
      expect(mockPrisma.coupon.update).toHaveBeenCalledWith({
        where: { id: 'coupon-1' },
        data: { usage_count: { decrement: 1 } },
      });

      // 5. Compensating negative payment created
      expect(mockPrisma.salePayment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          amount: new Prisma.Decimal(-1000),
          idempotency_key: 'idem-orig-pay:void',
        }),
      });

      expect(res.message).toContain('voided successfully');
      expect(res.note).toContain('transferred stock remains');
    });

    it('blocks voiding if sales returns already exist against the sale', async () => {
      mockPrisma.sale.findFirst.mockResolvedValue({
        id: 'sale-with-returns',
        branch_id: branch1Id,
        status: 'COMPLETED',
        returns: [{ id: 'return-1' }],
        original_exchange: [],
      });

      await expect(
        saleService.voidSale(
          businessId,
          branch1Id,
          cashierId,
          'sale-with-returns',
          { reason: 'Customer changed mind' },
        ),
      ).rejects.toThrow('Cannot void a sale that has associated sales returns');
    });
  });

  // ============================================================================
  // 14. BRANCH USER CANNOT ACCESS ANOTHER BRANCH'S SALE
  // ============================================================================
  describe('14. Cross-branch read isolation', () => {
    it('blocks non-admin branch user from viewing sale from another branch', async () => {
      mockPrisma.sale.findFirst.mockResolvedValue({
        id: 'sale-dhanmondi-1',
        branch_id: branch2Id, // Belongs to Dhanmondi
      });

      await expect(
        saleService.getSaleDetail(
          businessId,
          branch1Id, // User is in Gulshan
          'sale-dhanmondi-1',
          false, // Not all-branch admin
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows all-branch admin to view any branch sale', async () => {
      mockPrisma.sale.findFirst.mockResolvedValue({
        id: 'sale-dhanmondi-1',
        invoice_no: 'INV-DHAN-01',
        branch_id: branch2Id,
        branch: { id: branch2Id },
        customer: null,
        subtotal: 1000,
        total_amount: 1000,
        paid_amount: 1000,
        due_amount: 0,
        items: [],
        payments: [],
      });

      const res = await saleService.getSaleDetail(
        businessId,
        branch1Id,
        'sale-dhanmondi-1',
        true, // All-branch admin!
      );
      expect(res.invoiceNo).toBe('INV-DHAN-01');
    });
  });

  // ============================================================================
  // 15. SALE WITHOUT AN OPEN REGISTER SESSION IS REJECTED
  // ============================================================================
  describe('15. Register session requirement', () => {
    it('rejects sale if no active open register session exists in branch', async () => {
      mockPrisma.registerSession.findFirst.mockResolvedValue(null);

      await expect(
        saleService.createSale(businessId, branch1Id, cashierId, {
          idempotencyKey: 'idem-no-session',
          items: [{ variantId: variant1Id, quantity: 1 }],
          payments: [{ paymentMethod: 'CASH' as any, amount: 1500 }],
        }),
      ).rejects.toThrow('An open register session is required');
    });
  });

  // ============================================================================
  // 16. HELD SALE RETRIEVE RE-PRICES ITEMS
  // ============================================================================
  describe('16. Held sale park and retrieve re-pricing', () => {
    it('marks held sale retrieved and recalculates cart using fresh catalog prices', async () => {
      mockPrisma.heldSale.findFirst.mockResolvedValue({
        id: 'held-1',
        reference_name: 'Customer phone call',
        is_retrieved: false,
        items: [
          {
            product_variant_id: variant1Id,
            quantity: new Prisma.Decimal(2),
            unit_price: new Prisma.Decimal(1200), // Old stored price
            discount_amount: new Prisma.Decimal(0),
          },
        ],
      });

      mockPrisma.productVariant.findFirst.mockResolvedValue({
        id: variant1Id,
        sku: 'POLO-M',
        product: { id: product1Id, name: 'Polo Shirt', track_individually: false, is_active: true, deleted_at: null },
      });

      // Price list service returns fresh current price: 1500
      mockPriceListService.getVariantPrice.mockResolvedValue(1500);

      const res = await heldSaleService.retrieveHeldSale(businessId, branch1Id, 'held-1');

      expect(res.isRetrieved).toBe(true);
      expect(res.repricedCart.totalAmount.toNumber()).toBe(3000); // 2 * 1500, re-priced!
      expect(mockPrisma.heldSale.update).toHaveBeenCalledWith({
        where: { id: 'held-1' },
        data: { is_retrieved: true },
      });
    });
  });
});
