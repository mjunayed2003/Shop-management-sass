import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserService } from './user.service.js';
import { ForbiddenException, ConflictException, BadRequestException } from '@nestjs/common';

describe('UserService', () => {
  let service: UserService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      role: {
        findFirst: vi.fn(),
      },
      branch: {
        findMany: vi.fn(),
      },
      subscription: {
        findUnique: vi.fn(),
      },
      subscriptionOverride: {
        findFirst: vi.fn(),
      },
      userBranchAccess: {
        createMany: vi.fn(),
        deleteMany: vi.fn(),
      },
      userSession: {
        updateMany: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (cb) => cb(mockPrisma)),
    };

    service = new UserService(mockPrisma);
  });

  it('should enforce PlanLimit max_users when creating a user', async () => {
    mockPrisma.user.count.mockResolvedValue(3);
    mockPrisma.subscription.findUnique.mockResolvedValue({
      plan: { name: 'Starter', limits: { max_users: 3 } },
    });
    mockPrisma.subscriptionOverride.findFirst.mockResolvedValue(null);

    await expect(
      service.createUser('biz-1', 'actor-1', {
        firstName: 'Rahim',
        lastName: 'Uddin',
        email: 'rahim@test.com',
        phone: '01700000001',
        password: 'Password123!',
        roleId: 'role-1',
        branches: [{ branchId: 'b-1', isDefault: true }],
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should prevent deactivating the business owner', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'owner-1',
      is_owner: true,
      first_name: 'Owner',
      last_name: 'User',
    });

    await expect(
      service.updateStatus('biz-1', 'actor-1', 'owner-1', false),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should prevent a user from deactivating themselves', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'actor-1',
      is_owner: false,
      first_name: 'Regular',
      last_name: 'User',
    });

    await expect(
      service.updateStatus('biz-1', 'actor-1', 'actor-1', false),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should reject updating branches with zero branches', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      is_owner: false,
    });

    await expect(
      service.updateBranches('biz-1', 'actor-1', 'user-1', { branches: [] }),
    ).rejects.toThrow(BadRequestException);
  });
});
