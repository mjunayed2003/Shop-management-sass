import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateBranchDto } from './dto/create-branch.dto.js';
import { UpdateBranchDto } from './dto/update-branch.dto.js';
import { AssignUserBranchDto } from './dto/assign-user-branch.dto.js';
import type { SequenceType } from '../../generated/prisma/client.js';

@Injectable()
export class BranchService {
  constructor(private readonly prisma: PrismaService) {}

  async createBranch(businessId: string, userId: string, dto: CreateBranchDto) {
    const code = dto.code.trim().toUpperCase();

    // 1. Verify Plan Limit for Branches (including any SuperAdmin overrides)
    const activeBranchesCount = await this.prisma.branch.count({
      where: {
        business_id: businessId,
        is_active: true,
        deleted_at: null,
      },
    });

    const subscription = await this.prisma.subscription.findUnique({
      where: { business_id: businessId },
      include: {
        plan: { include: { limits: true } },
      },
    });

    const now = new Date();
    const override = await this.prisma.subscriptionOverride.findFirst({
      where: {
        business_id: businessId,
        override_max_branches: { not: null },
        OR: [
          { valid_until: null },
          { valid_until: { gte: now } },
        ],
      },
      orderBy: { created_at: 'desc' },
    });

    const maxAllowedBranches =
      override?.override_max_branches ??
      subscription?.plan?.limits?.max_branches ??
      1;

    if (activeBranchesCount >= maxAllowedBranches) {
      throw new ForbiddenException(
        `Branch limit reached. Your subscription plan (${subscription?.plan?.name || 'Current'}) allows up to ${maxAllowedBranches} active branch(es). Please upgrade your subscription to open more branches.`,
      );
    }

    // 2. Check code uniqueness within this business
    const existing = await this.prisma.branch.findUnique({
      where: {
        business_id_code: {
          business_id: businessId,
          code,
        },
      },
    });

    if (existing && existing.deleted_at === null) {
      throw new ConflictException(
        `Branch with code "${code}" already exists in your business.`,
      );
    }

    // 3. Create branch, cash register, and invoice sequences inside a single transaction
    const newBranch = await this.prisma.$transaction(async (tx) => {
      const branch = await tx.branch.create({
        data: {
          business_id: businessId,
          name: dto.name.trim(),
          code,
          address: dto.address.trim(),
          city: dto.city?.trim() || 'Dhaka',
          state: dto.state?.trim() || null,
          postal_code: dto.postalCode?.trim() || null,
          phone: dto.phone.trim(),
          email: dto.email?.trim().toLowerCase() || null,
          is_main: false,
          is_active: true,
        },
      });

      // Auto-create standard invoice sequences for this new branch
      const sequences: { type: SequenceType; prefix: string }[] = [
        { type: 'SALE_INVOICE', prefix: 'INV-' },
        { type: 'PURCHASE_INVOICE', prefix: 'PO-' },
        { type: 'RETURN_INVOICE', prefix: 'RET-' },
        { type: 'TRANSFER_INVOICE', prefix: 'TRN-' },
        { type: 'JOURNAL_ENTRY', prefix: 'JE-' },
        { type: 'EXPENSE_VOUCHER', prefix: 'EXP-' },
      ];

      await tx.invoiceSequence.createMany({
        data: sequences.map((seq) => ({
          business_id: businessId,
          branch_id: branch.id,
          sequence_type: seq.type,
          prefix: seq.prefix,
          next_number: 1,
        })),
      });

      // Auto-create default CashRegister for the new branch
      await tx.cashRegister.create({
        data: {
          business_id: businessId,
          branch_id: branch.id,
          name: 'Counter 1',
          code: 'REG-01',
          is_active: true,
        },
      });

      // Assign creator user to the branch
      await tx.userBranchAccess.upsert({
        where: {
          user_id_branch_id: {
            user_id: userId,
            branch_id: branch.id,
          },
        },
        create: {
          business_id: businessId,
          user_id: userId,
          branch_id: branch.id,
          is_default: false,
        },
        update: {},
      });

      return branch;
    });

    return {
      message: 'Branch created successfully with default invoice sequences and cash register.',
      branch: newBranch,
    };
  }

  async listBranches(
    businessId: string,
    userId: string,
    isOwner: boolean,
    includeInactive = false,
  ) {
    if (isOwner) {
      return this.prisma.branch.findMany({
        where: {
          business_id: businessId,
          deleted_at: null,
          ...(includeInactive ? {} : { is_active: true }),
        },
        include: {
          cash_registers: {
            where: { is_active: true },
            select: { id: true, name: true, code: true, is_active: true },
          },
          _count: {
            select: { user_branch_access: true },
          },
        },
        orderBy: [{ is_main: 'desc' }, { created_at: 'asc' }],
      });
    }

    // Non-owner: list only branches where user has UserBranchAccess
    const accessList = await this.prisma.userBranchAccess.findMany({
      where: {
        business_id: businessId,
        user_id: userId,
      },
      select: {
        branch_id: true,
        is_default: true,
      },
    });

    const allowedBranchIds = accessList.map((a) => a.branch_id);

    return this.prisma.branch.findMany({
      where: {
        id: { in: allowedBranchIds },
        business_id: businessId,
        deleted_at: null,
        ...(includeInactive ? {} : { is_active: true }),
      },
      include: {
        cash_registers: {
          where: { is_active: true },
          select: { id: true, name: true, code: true, is_active: true },
        },
      },
      orderBy: [{ is_main: 'desc' }, { created_at: 'asc' }],
    });
  }

  async getBranch(businessId: string, branchId: string, userId: string, isOwner: boolean) {
    const branch = await this.prisma.branch.findFirst({
      where: {
        id: branchId,
        business_id: businessId,
        deleted_at: null,
      },
      include: {
        cash_registers: { where: { is_active: true } },
        invoice_sequences: true,
        user_branch_access: {
          include: {
            user: {
              select: {
                id: true,
                first_name: true,
                last_name: true,
                email: true,
                phone: true,
                role: { select: { id: true, name: true, code: true } },
              },
            },
          },
        },
      },
    });

    if (!branch) {
      throw new NotFoundException(`Branch with ID "${branchId}" not found in your business.`);
    }

    if (!isOwner) {
      const hasAccess = branch.user_branch_access.some((uba) => uba.user_id === userId);
      if (!hasAccess) {
        throw new ForbiddenException(`You do not have access to view this branch.`);
      }
    }

    return branch;
  }

  async updateBranch(businessId: string, branchId: string, dto: UpdateBranchDto) {
    const branch = await this.prisma.branch.findFirst({
      where: {
        id: branchId,
        business_id: businessId,
        deleted_at: null,
      },
    });

    if (!branch) {
      throw new NotFoundException(`Branch with ID "${branchId}" not found in your business.`);
    }

    // Business Rule 1: The last active branch can never be deleted or deactivated
    if (dto.isActive === false && branch.is_active) {
      const activeCount = await this.prisma.branch.count({
        where: {
          business_id: businessId,
          is_active: true,
          deleted_at: null,
        },
      });

      if (activeCount <= 1) {
        throw new BadRequestException(
          'Cannot deactivate the last active branch of a business. Every business must always have at least one active branch.',
        );
      }
    }

    const updated = await this.prisma.branch.update({
      where: { id: branchId },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.address ? { address: dto.address.trim() } : {}),
        ...(dto.city ? { city: dto.city.trim() } : {}),
        ...(dto.state !== undefined ? { state: dto.state?.trim() || null } : {}),
        ...(dto.postalCode !== undefined ? { postal_code: dto.postalCode?.trim() || null } : {}),
        ...(dto.phone ? { phone: dto.phone.trim() } : {}),
        ...(dto.email !== undefined ? { email: dto.email?.trim().toLowerCase() || null } : {}),
        ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}),
      },
    });

    return {
      message: 'Branch updated successfully',
      branch: updated,
    };
  }

  async deactivateBranch(businessId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: {
        id: branchId,
        business_id: businessId,
        deleted_at: null,
      },
    });

    if (!branch) {
      throw new NotFoundException(`Branch with ID "${branchId}" not found in your business.`);
    }

    if (!branch.is_active) {
      return {
        message: 'Branch is already inactive',
        branch,
      };
    }

    // Business Rule 1: The last active branch can never be deleted or deactivated
    const activeCount = await this.prisma.branch.count({
      where: {
        business_id: businessId,
        is_active: true,
        deleted_at: null,
      },
    });

    if (activeCount <= 1) {
      throw new BadRequestException(
        'Cannot deactivate the last active branch of a business. Every business must always have at least one active branch.',
      );
    }

    const updated = await this.prisma.branch.update({
      where: { id: branchId },
      data: { is_active: false },
    });

    return {
      message: 'Branch deactivated successfully',
      branch: updated,
    };
  }

  async assignUser(businessId: string, branchId: string, dto: AssignUserBranchDto) {
    // Verify branch exists and is active
    const branch = await this.prisma.branch.findFirst({
      where: {
        id: branchId,
        business_id: businessId,
        deleted_at: null,
      },
    });

    if (!branch) {
      throw new NotFoundException(`Branch with ID "${branchId}" not found in your business.`);
    }

    // Verify user belongs to this business
    const user = await this.prisma.user.findFirst({
      where: {
        id: dto.userId,
        business_id: businessId,
        deleted_at: null,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID "${dto.userId}" not found in your business.`);
    }

    const isDefault = dto.isDefault ?? false;

    await this.prisma.$transaction(async (tx) => {
      if (isDefault) {
        // Reset existing default branch for this user
        await tx.userBranchAccess.updateMany({
          where: {
            user_id: user.id,
            business_id: businessId,
          },
          data: { is_default: false },
        });
      }

      await tx.userBranchAccess.upsert({
        where: {
          user_id_branch_id: {
            user_id: user.id,
            branch_id: branch.id,
          },
        },
        create: {
          business_id: businessId,
          user_id: user.id,
          branch_id: branch.id,
          is_default: isDefault,
        },
        update: {
          is_default: isDefault,
        },
      });
    });

    return {
      message: `User ${user.first_name} ${user.last_name} successfully granted access to branch "${branch.name}".`,
    };
  }

  async removeUser(businessId: string, branchId: string, targetUserId: string) {
    // Verify branch
    const branch = await this.prisma.branch.findFirst({
      where: {
        id: branchId,
        business_id: businessId,
        deleted_at: null,
      },
    });

    if (!branch) {
      throw new NotFoundException(`Branch with ID "${branchId}" not found in your business.`);
    }

    // Verify target user
    const targetUser = await this.prisma.user.findFirst({
      where: {
        id: targetUserId,
        business_id: businessId,
        deleted_at: null,
      },
    });

    if (!targetUser) {
      throw new NotFoundException(`User with ID "${targetUserId}" not found in your business.`);
    }

    // Business rule: Owner access cannot be revoked
    if (targetUser.is_owner) {
      throw new ForbiddenException('Cannot revoke branch access for the business owner.');
    }

    const existingAccess = await this.prisma.userBranchAccess.findUnique({
      where: {
        user_id_branch_id: {
          user_id: targetUserId,
          branch_id: branchId,
        },
      },
    });

    if (!existingAccess) {
      throw new NotFoundException('User does not have access to this branch.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userBranchAccess.delete({
        where: {
          user_id_branch_id: {
            user_id: targetUserId,
            branch_id: branchId,
          },
        },
      });

      // If this was the default branch, pick another accessible branch as default if available
      if (existingAccess.is_default) {
        const anotherAccess = await tx.userBranchAccess.findFirst({
          where: {
            user_id: targetUserId,
            business_id: businessId,
          },
        });

        if (anotherAccess) {
          await tx.userBranchAccess.update({
            where: { id: anotherAccess.id },
            data: { is_default: true },
          });
        }
      }
    });

    return {
      message: `Access to branch "${branch.name}" revoked for user ${targetUser.first_name} ${targetUser.last_name}.`,
    };
  }
}
