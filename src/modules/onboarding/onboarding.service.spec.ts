import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { OnboardingService } from './onboarding.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { JwtService } from '@nestjs/jwt';

describe('OnboardingService', () => {
  let service: OnboardingService;
  let mockPrisma: any;
  let mockJwtService: any;

  beforeEach(() => {
    mockPrisma = {
      business: {
        findUnique: vi.fn(),
      },
      plan: {
        findUnique: vi.fn(),
      },
      permission: {
        findMany: vi.fn(),
      },
      userSession: {
        create: vi.fn(),
      },
      $transaction: vi.fn(),
    };

    mockJwtService = {
      signAsync: vi.fn().mockResolvedValue('mock-jwt-access-token-12345'),
    };

    service = new OnboardingService(
      mockPrisma as unknown as PrismaService,
      mockJwtService as unknown as JwtService,
    );
  });

  it('should reject onboarding if business slug is already taken', async () => {
    mockPrisma.business.findUnique.mockResolvedValue({ id: 'existing-id', slug: 'aarong-boutique' });

    await expect(
      service.onboard({
        businessName: 'Aarong Boutique',
        businessSlug: 'aarong-boutique',
        phone: '01711000111',
        email: 'info@aarong.com',
        ownerFirstName: 'Kamal',
        ownerLastName: 'Hossain',
        password: 'Password123!',
        branchName: 'Main Showroom',
        branchAddress: 'Gulshan, Dhaka',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('should successfully onboard a new business with all required tenant entities in a single transaction', async () => {
    mockPrisma.business.findUnique.mockResolvedValue(null);
    mockPrisma.plan.findUnique.mockResolvedValue({
      id: 'plan-starter-id',
      code: 'STARTER',
      name: 'Starter Boutique Plan',
      trial_days: 30,
      limits: { max_branches: 1 },
    });
    mockPrisma.permission.findMany.mockResolvedValue([
      { id: 'p1', code: 'branches:read', module: 'Branches' },
      { id: 'p2', code: 'sales:create', module: 'Sales' },
      { id: 'p3', code: 'pos:access', module: 'Sales' },
      { id: 'p4', code: 'roles:manage', module: 'Users' },
    ]);

    const createdBusiness = {
      id: 'biz-123',
      name: 'Fabrics & Co',
      slug: 'fabrics-co',
      phone: '01700112233',
      email: 'owner@fabrics.com',
      currency: 'BDT',
      timezone: 'Asia/Dhaka',
    };

    const createdSubscription = {
      id: 'sub-123',
      status: 'TRIAL',
      trial_ends_at: new Date(),
    };

    const createdBranch = {
      id: 'branch-123',
      name: 'Flagship Showroom',
      code: 'MAIN',
      address: 'Banani, Dhaka',
      is_main: true,
      is_active: true,
    };

    const createdOwner = {
      id: 'user-123',
      first_name: 'Sadia',
      last_name: 'Islam',
      email: 'owner@fabrics.com',
      phone: '01700112233',
      is_owner: true,
    };

    mockPrisma.$transaction.mockImplementation(async (callback: any) => {
      const tx = {
        business: { create: vi.fn().mockResolvedValue(createdBusiness) },
        subscription: { create: vi.fn().mockResolvedValue(createdSubscription) },
        branch: { create: vi.fn().mockResolvedValue(createdBranch) },
        role: {
          create: vi.fn().mockImplementation((args: any) => ({
            id: `role-${args.data.code}`,
            code: args.data.code,
          })),
        },
        user: { create: vi.fn().mockResolvedValue(createdOwner) },
        userBranchAccess: { create: vi.fn().mockResolvedValue({ id: 'uba-123' }) },
        invoiceSequence: { createMany: vi.fn().mockResolvedValue({ count: 6 }) },
        cashRegister: {
          create: vi.fn().mockResolvedValue({ id: 'cr-123', code: 'REG-01', name: 'Counter 1' }),
        },
        unit: { createMany: vi.fn().mockResolvedValue({ count: 5 }) },
        size: { createMany: vi.fn().mockResolvedValue({ count: 6 }) },
        color: { createMany: vi.fn().mockResolvedValue({ count: 6 }) },
        expenseCategory: { createMany: vi.fn().mockResolvedValue({ count: 6 }) },
      };
      return callback(tx);
    });

    mockPrisma.userSession.create.mockResolvedValue({
      id: 'sess-123',
      expires_at: new Date(Date.now() + 86400000),
    });

    const response = await service.onboard({
      businessName: 'Fabrics & Co',
      businessSlug: 'fabrics-co',
      phone: '01700112233',
      email: 'owner@fabrics.com',
      ownerFirstName: 'Sadia',
      ownerLastName: 'Islam',
      password: 'SecurePassword123!',
      branchName: 'Flagship Showroom',
      branchAddress: 'Banani, Dhaka',
    });

    expect(response).toBeDefined();
    expect(response.accessToken).toBe('mock-jwt-access-token-12345');
    expect(response.business.slug).toBe('fabrics-co');
    expect(response.mainBranch.isMain).toBe(true);
    expect(response.owner.isOwner).toBe(true);
    expect(response.subscription.status).toBe('TRIAL');
    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
  });
});
