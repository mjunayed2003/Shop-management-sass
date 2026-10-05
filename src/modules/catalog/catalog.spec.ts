import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ProductService } from './services/product.service.js';
import { VariantService } from './services/variant.service.js';
import { ProductBranchService } from './services/product-branch.service.js';
import { BarcodeService } from './services/barcode.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

describe('Phase 2: Catalog Module Unit Tests', () => {
  let mockPrisma: any;
  let productService: ProductService;
  let variantService: VariantService;
  let productBranchService: ProductBranchService;
  let barcodeService: BarcodeService;

  const businessId = 'biz-111';
  const branch1Id = 'branch-1-gulshan';
  const branch2Id = 'branch-2-dhanmondi';

  beforeEach(() => {
    mockPrisma = {
      product: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      productVariant: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      productBranch: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        createMany: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
      },
      stockBalance: {
        aggregate: vi.fn(),
        createMany: vi.fn(),
        upsert: vi.fn(),
      },
      category: { findFirst: vi.fn() },
      brand: { findFirst: vi.fn() },
      season: { findFirst: vi.fn() },
      unit: { findFirst: vi.fn() },
      size: { findFirst: vi.fn(), findMany: vi.fn() },
      color: { findFirst: vi.fn(), findMany: vi.fn() },
      branch: { findFirst: vi.fn() },
      barcodePrintLog: { create: vi.fn() },
      $transaction: vi.fn(),
    };

    variantService = new VariantService(mockPrisma as unknown as PrismaService);
    productService = new ProductService(
      mockPrisma as unknown as PrismaService,
      variantService,
    );
    productBranchService = new ProductBranchService(
      mockPrisma as unknown as PrismaService,
    );
    barcodeService = new BarcodeService(mockPrisma as unknown as PrismaService);
  });

  describe('1. Branch user cannot see product from another branch', () => {
    it('should filter products by active ProductBranch for non-admin branch users', async () => {
      mockPrisma.product.count.mockResolvedValue(1);
      mockPrisma.product.findMany.mockResolvedValue([]);

      await productService.listProducts(businessId, branch1Id, false, {
        page: 1,
        limit: 10,
      });

      expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            business_id: businessId,
            branches: {
              some: {
                branch_id: branch1Id,
                is_active: true,
              },
            },
          }),
        }),
      );
    });

    it('should throw NotFoundException if branch user requests a product not active in their branch', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({
        id: 'prod-other',
        name: 'Taaga Top',
        branches: [{ branch_id: branch2Id, is_active: true }],
        variants: [],
      });

      await expect(
        productService.getProduct(businessId, branch1Id, false, 'prod-other'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('2. Admin sees all products across branches', () => {
    it('should NOT restrict query to single branch when isAllBranchAdmin is true', async () => {
      mockPrisma.product.count.mockResolvedValue(2);
      mockPrisma.product.findMany.mockResolvedValue([
        {
          id: 'prod-1',
          name: 'Panjabi',
          code: 'PJ-01',
          branches: [
            { branch_id: branch1Id, is_active: true, branch: { id: branch1Id, name: 'Gulshan', code: 'GUL' } },
            { branch_id: branch2Id, is_active: false, branch: { id: branch2Id, name: 'Dhanmondi', code: 'DHN' } },
          ],
          variants: [],
        },
      ]);

      const res = await productService.listProducts(businessId, branch1Id, true, {
        page: 1,
        limit: 10,
      });

      // Verify no branch filter was imposed
      expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({
            branches: expect.anything(),
          }),
        }),
      );

      expect(res.data[0].branches).toHaveLength(2);
      expect(res.data[0].branches[0].branchName).toBe('Gulshan');
      expect(res.data[0].branches[1].branchName).toBe('Dhanmondi');
    });
  });

  describe('3. Create product auto-creates ProductBranch for current branch', () => {
    it('should insert ProductBranch row for current branch during product creation', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null); // Code unique
      mockPrisma.category.findFirst.mockResolvedValue({ id: 'cat-1' });
      mockPrisma.unit.findFirst.mockResolvedValue({ id: 'unit-1' });

      const createdProd = {
        id: 'new-prod-id',
        name: 'Kurta',
        code: 'KRT-01',
      };
      const createdVariant = {
        id: 'var-1',
        sku: 'KRT-01',
        barcode: '881234567890',
        retail_price: 1500,
      };

      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          product: { create: vi.fn().mockResolvedValue(createdProd) },
          productBranch: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
          productVariant: {
            findUnique: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue(createdVariant),
          },
          stockBalance: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
        };
        return callback(tx);
      });

      const res = await productService.createProduct(
        businessId,
        branch1Id,
        'user-1',
        true,
        {
          name: 'Kurta',
          code: 'KRT-01',
          categoryId: 'cat-1',
          unitId: 'unit-1',
          variants: [{ retailPrice: 1500 }],
        },
      );

      expect(res.product.id).toBe('new-prod-id');
      expect(res.assignedBranches).toContain(branch1Id);
    });
  });

  describe('4. Barcode lookup returns PRODUCT_IN_OTHER_BRANCH correctly', () => {
    it('should return PRODUCT_IN_OTHER_BRANCH with stock list when product is not in current branch', async () => {
      mockPrisma.productVariant.findFirst.mockResolvedValue({
        id: 'var-99',
        sku: 'SHIRT-SLIM-40',
        barcode: '889988776655',
        retail_price: 2200,
        product: {
          id: 'prod-99',
          name: 'Formal Shirt',
          code: 'FS-01',
          deleted_at: null,
          branches: [
            {
              branch_id: branch2Id,
              is_active: true,
              branch: { id: branch2Id, name: 'Dhanmondi Showroom', code: 'DHN' },
            },
          ],
        },
        stock_balances: [
          {
            branch_id: branch2Id,
            quantity: 14,
            branch: { id: branch2Id, name: 'Dhanmondi Showroom', code: 'DHN' },
          },
        ],
      });

      // Look up from branch1 (Gulshan), where product is NOT active
      const res = await barcodeService.lookupBarcode(
        businessId,
        branch1Id,
        '889988776655',
      );

      expect(res.found).toBe(true);
      expect(res.activeInCurrentBranch).toBe(false);
      expect(res.code).toBe('PRODUCT_IN_OTHER_BRANCH');
      expect(res.availableBranches).toHaveLength(1);
      expect(res.availableBranches[0].branchId).toBe(branch2Id);
      expect(res.availableBranches[0].stock).toBe(14);
    });

    it('should return active product details when scanned in active branch', async () => {
      mockPrisma.productVariant.findFirst.mockResolvedValue({
        id: 'var-99',
        sku: 'SHIRT-SLIM-40',
        barcode: '889988776655',
        retail_price: 2200,
        product: {
          id: 'prod-99',
          name: 'Formal Shirt',
          code: 'FS-01',
          deleted_at: null,
          branches: [
            {
              branch_id: branch1Id,
              is_active: true,
              branch: { id: branch1Id, name: 'Gulshan Showroom', code: 'GUL' },
            },
          ],
        },
        stock_balances: [
          {
            branch_id: branch1Id,
            quantity: 8,
            branch: { id: branch1Id, name: 'Gulshan Showroom', code: 'GUL' },
          },
        ],
      });

      const res = await barcodeService.lookupBarcode(
        businessId,
        branch1Id,
        '889988776655',
      );

      expect(res.found).toBe(true);
      expect(res.activeInCurrentBranch).toBe(true);
      expect(res.variant.stock).toBe(8);
    });
  });

  describe('5. Duplicate SKU / Barcode rejected', () => {
    it('should reject creating variant with duplicate SKU', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({
        id: 'prod-1',
        code: 'PJ-01',
        branches: [],
      });

      mockPrisma.productVariant.findUnique.mockImplementation(async (args: any) => {
        if (args.where?.business_id_sku?.sku === 'DUPLICATE-SKU') {
          return { id: 'existing-v1', sku: 'DUPLICATE-SKU', deleted_at: null };
        }
        return null;
      });

      await expect(
        variantService.createVariant(businessId, 'prod-1', {
          sku: 'DUPLICATE-SKU',
          barcode: '881122334455',
          retailPrice: 1000,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject creating variant with duplicate Barcode', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({
        id: 'prod-1',
        code: 'PJ-01',
        branches: [],
      });

      mockPrisma.productVariant.findUnique.mockImplementation(async (args: any) => {
        if (args.where?.business_id_barcode?.barcode === 'DUPLICATE-BARCODE') {
          return { id: 'existing-v1', barcode: 'DUPLICATE-BARCODE', deleted_at: null };
        }
        return null;
      });

      await expect(
        variantService.createVariant(businessId, 'prod-1', {
          sku: 'UNIQUE-SKU',
          barcode: 'DUPLICATE-BARCODE',
          retailPrice: 1000,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('6. Cannot deactivate product in branch with stock unless force', () => {
    it('should throw BadRequestException if branch has stock and force is false', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({ id: 'prod-1', name: 'Panjabi' });
      mockPrisma.branch.findFirst.mockResolvedValue({ id: branch1Id, name: 'Gulshan' });
      mockPrisma.productBranch.findUnique.mockResolvedValue({ is_active: true });

      mockPrisma.stockBalance.aggregate.mockResolvedValue({
        _sum: { quantity: 15 },
      });

      await expect(
        productBranchService.deactivateProductInBranch(
          businessId,
          'prod-1',
          branch1Id,
          false,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should succeed in deactivating if force is true even when stock > 0', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({ id: 'prod-1', name: 'Panjabi' });
      mockPrisma.branch.findFirst.mockResolvedValue({ id: branch1Id, name: 'Gulshan' });
      mockPrisma.productBranch.findUnique.mockResolvedValue({ is_active: true });

      mockPrisma.stockBalance.aggregate.mockResolvedValue({
        _sum: { quantity: 15 },
      });

      mockPrisma.productBranch.update.mockResolvedValue({ is_active: false });

      const res = await productBranchService.deactivateProductInBranch(
        businessId,
        'prod-1',
        branch1Id,
        true, // force = true
      );

      expect(res.productBranch.is_active).toBe(false);
      expect(mockPrisma.productBranch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { is_active: false },
        }),
      );
    });
  });

  describe('7. Bulk variant generator creates correct combinations', () => {
    it('should create Cartesian product of sizes x colors (2 sizes * 3 colors = 6 variants)', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({
        id: 'prod-bulk',
        code: 'TEE-01',
        branches: [{ branch_id: branch1Id }],
        variants: [],
      });

      mockPrisma.size.findMany.mockResolvedValue([
        { id: 's-m', code: 'M' },
        { id: 's-l', code: 'L' },
      ]);

      mockPrisma.color.findMany.mockResolvedValue([
        { id: 'c-blk', code: 'BLK' },
        { id: 'c-wht', code: 'WHT' },
        { id: 'c-red', code: 'RED' },
      ]);

      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          productVariant: {
            findUnique: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockImplementation((args: any) => ({
              id: `v-${Math.random()}`,
              ...args.data,
            })),
          },
          stockBalance: { upsert: vi.fn().mockResolvedValue({}) },
        };
        return callback(tx);
      });

      const res = await variantService.bulkGenerateVariants(
        businessId,
        'prod-bulk',
        {
          sizeIds: ['s-m', 's-l'],
          colorIds: ['c-blk', 'c-wht', 'c-red'],
          defaultRetailPrice: 950,
          defaultCostPrice: 550,
        },
      );

      expect(res.createdCount).toBe(6);
      expect(res.variants).toHaveLength(6);
    });
  });
});
