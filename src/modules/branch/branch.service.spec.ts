import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { BranchService } from './branch.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

describe('BranchService', () => {
  let service: BranchService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      branch: {
        count: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      subscription: {
        findUnique: vi.fn(),
      },
      subscriptionOverride: {
        findFirst: vi.fn(),
      },
      user: {
        findFirst: vi.fn(),
      },
      userBranchAccess: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        upsert: vi.fn(),
        delete: vi.fn(),
        updateMany: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn(),
    };

    service = new BranchService(mockPrisma as unknown as PrismaService);
  });

  describe('Business Rule 1: The last active branch can never be deleted or deactivated', () => {
    it('should throw BadRequestException when attempting to deactivate the only active branch', async () => {
      const businessId = 'biz-123';
      const branchId = 'main-branch-id';

      mockPrisma.branch.findFirst.mockResolvedValue({
        id: branchId,
        business_id: businessId,
        is_active: true,
        is_main: true,
      });

      mockPrisma.branch.count.mockResolvedValue(1); // Only 1 active branch left

      await expect(service.deactivateBranch(businessId, branchId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when updateBranch sets isActive=false on the last active branch', async () => {
      const businessId = 'biz-123';
      const branchId = 'main-branch-id';

      mockPrisma.branch.findFirst.mockResolvedValue({
        id: branchId,
        business_id: businessId,
        is_active: true,
      });

      mockPrisma.branch.count.mockResolvedValue(1);

      await expect(
        service.updateBranch(businessId, branchId, { isActive: false }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow deactivating a branch when other active branches exist', async () => {
      const businessId = 'biz-123';
      const branchId = 'branch-2';

      mockPrisma.branch.findFirst.mockResolvedValue({
        id: branchId,
        business_id: businessId,
        is_active: true,
        is_main: false,
      });

      mockPrisma.branch.count.mockResolvedValue(2); // 2 active branches
      mockPrisma.branch.update.mockResolvedValue({
        id: branchId,
        is_active: false,
      });

      const result = await service.deactivateBranch(businessId, branchId);
      expect(result.branch.is_active).toBe(false);
      expect(mockPrisma.branch.update).toHaveBeenCalledWith({
        where: { id: branchId },
        data: { is_active: false },
      });
    });
  });

  describe('Branch creation and Plan Limits', () => {
    it('should block branch creation if PlanLimit.max_branches is reached', async () => {
      const businessId = 'biz-123';
      const userId = 'user-owner';

      mockPrisma.branch.count.mockResolvedValue(1); // 1 active branch exists
      mockPrisma.subscription.findUnique.mockResolvedValue({
        plan: {
          name: 'Starter Plan',
          limits: { max_branches: 1 },
        },
      });
      mockPrisma.subscriptionOverride.findFirst.mockResolvedValue(null);

      await expect(
        service.createBranch(businessId, userId, {
          name: 'Second Branch',
          code: 'BRANCH2',
          address: 'Dhanmondi, Dhaka',
          phone: '01711223344',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should auto-create invoice sequences and a cash register on branch creation', async () => {
      const businessId = 'biz-123';
      const userId = 'user-owner';

      mockPrisma.branch.count.mockResolvedValue(1);
      mockPrisma.subscription.findUnique.mockResolvedValue({
        plan: {
          name: 'Business Plan',
          limits: { max_branches: 5 },
        },
      });
      mockPrisma.subscriptionOverride.findFirst.mockResolvedValue(null);
      mockPrisma.branch.findUnique.mockResolvedValue(null); // Code not taken

      const newBranch = {
        id: 'branch-new-id',
        business_id: businessId,
        name: 'Uttara Branch',
        code: 'UTTARA',
        is_active: true,
        is_main: false,
      };

      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          branch: { create: vi.fn().mockResolvedValue(newBranch) },
          invoiceSequence: { createMany: vi.fn().mockResolvedValue({ count: 6 }) },
          cashRegister: { create: vi.fn().mockResolvedValue({ id: 'cr-2', code: 'REG-01' }) },
          userBranchAccess: { upsert: vi.fn().mockResolvedValue({}) },
        };
        return callback(tx);
      });

      const res = await service.createBranch(businessId, userId, {
        name: 'Uttara Branch',
        code: 'UTTARA',
        address: 'Sector 3, Uttara',
        phone: '01799887766',
      });

      expect(res).toBeDefined();
      expect(res.branch.id).toBe('branch-new-id');
      expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
    });
  });

  describe('User Branch Assignment and Access Control', () => {
    it('should assign a staff user to a branch and support default branch setting', async () => {
      const businessId = 'biz-123';
      const branchId = 'branch-1';
      const staffUserId = 'staff-user-1';

      mockPrisma.branch.findFirst.mockResolvedValue({ id: branchId, business_id: businessId });
      mockPrisma.user.findFirst.mockResolvedValue({
        id: staffUserId,
        first_name: 'Tareq',
        last_name: 'Mahmud',
      });

      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          userBranchAccess: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            upsert: vi.fn().mockResolvedValue({ user_id: staffUserId, branch_id: branchId }),
          },
        };
        return callback(tx);
      });

      const res = await service.assignUser(businessId, branchId, {
        userId: staffUserId,
        isDefault: true,
      });

      expect(res.message).toContain('Tareq Mahmud');
    });

    it('should forbid revoking branch access from the business owner', async () => {
      const businessId = 'biz-123';
      const branchId = 'branch-1';
      const ownerId = 'owner-id';

      mockPrisma.branch.findFirst.mockResolvedValue({ id: branchId, business_id: businessId });
      mockPrisma.user.findFirst.mockResolvedValue({
        id: ownerId,
        business_id: businessId,
        is_owner: true,
      });

      await expect(service.removeUser(businessId, branchId, ownerId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
