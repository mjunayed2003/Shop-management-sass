import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UpdateUserBranchesDto } from './dto/update-user-branches.dto.js';
import { UserQueryDto } from './dto/user-query.dto.js';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(businessId: string, query: UserQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = {
      business_id: businessId,
      deleted_at: null,
    };

    if (query.isActive !== undefined) {
      where.is_active = query.isActive;
    }

    if (query.roleId) {
      where.role_id = query.roleId;
    }

    if (query.branchId) {
      where.user_branch_access = {
        some: {
          branch_id: query.branchId,
        },
      };
    }

    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { first_name: { contains: s, mode: 'insensitive' } },
        { last_name: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s } },
      ];
    }

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        include: {
          role: true,
          user_branch_access: {
            include: {
              branch: true,
            },
          },
        },
        orderBy: [{ is_owner: 'desc' }, { created_at: 'desc' }],
      }),
    ]);

    const data = users.map((u) => ({
      id: u.id,
      firstName: u.first_name,
      lastName: u.last_name,
      fullName: `${u.first_name} ${u.last_name}`.trim(),
      email: u.email,
      phone: u.phone,
      isOwner: u.is_owner,
      isActive: u.is_active,
      role: {
        id: u.role.id,
        name: u.role.name,
        code: u.role.code,
        isSystem: u.role.is_system,
      },
      branches: u.user_branch_access.map((uba) => ({
        id: uba.branch.id,
        name: uba.branch.name,
        code: uba.branch.code,
        isDefault: uba.is_default,
      })),
      defaultBranch: u.user_branch_access.find((uba) => uba.is_default)?.branch
        ? {
            id: u.user_branch_access.find((uba) => uba.is_default)!.branch.id,
            name: u.user_branch_access.find((uba) => uba.is_default)!.branch.name,
            code: u.user_branch_access.find((uba) => uba.is_default)!.branch.code,
          }
        : null,
      createdAt: u.created_at,
      updatedAt: u.updated_at,
    }));

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getUser(businessId: string, userId: string) {
    const u = await this.prisma.user.findFirst({
      where: { id: userId, business_id: businessId, deleted_at: null },
      include: {
        role: {
          include: {
            role_permissions: {
              include: { permission: true },
            },
          },
        },
        user_branch_access: {
          include: {
            branch: true,
          },
        },
      },
    });

    if (!u) {
      throw new NotFoundException(`User with ID "${userId}" not found`);
    }

    return {
      id: u.id,
      firstName: u.first_name,
      lastName: u.last_name,
      fullName: `${u.first_name} ${u.last_name}`.trim(),
      email: u.email,
      phone: u.phone,
      isOwner: u.is_owner,
      isActive: u.is_active,
      role: {
        id: u.role.id,
        name: u.role.name,
        code: u.role.code,
        isSystem: u.role.is_system,
        permissions: u.role.role_permissions.map((rp) => rp.permission.code),
      },
      branches: u.user_branch_access.map((uba) => ({
        id: uba.branch.id,
        name: uba.branch.name,
        code: uba.branch.code,
        isDefault: uba.is_default,
      })),
      defaultBranch: u.user_branch_access.find((uba) => uba.is_default)?.branch || null,
      createdAt: u.created_at,
      updatedAt: u.updated_at,
    };
  }

  async createUser(businessId: string, actorUserId: string, dto: CreateUserDto) {
    // 1. Verify Plan Limit for Users
    const activeUsersCount = await this.prisma.user.count({
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
        override_max_users: { not: null },
        OR: [{ valid_until: null }, { valid_until: { gte: now } }],
      },
      orderBy: { created_at: 'desc' },
    });

    const maxAllowedUsers =
      override?.override_max_users ??
      subscription?.plan?.limits?.max_users ??
      3;

    if (activeUsersCount >= maxAllowedUsers) {
      throw new ForbiddenException(
        `User limit reached. Your subscription plan (${subscription?.plan?.name || 'Current'}) allows up to ${maxAllowedUsers} active users. Please upgrade your subscription to add more staff members.`,
      );
    }

    // 2. Uniqueness check for email and phone within business
    const cleanEmail = dto.email.trim().toLowerCase();
    const cleanPhone = dto.phone.trim();

    const existingEmail = await this.prisma.user.findFirst({
      where: { business_id: businessId, email: cleanEmail, deleted_at: null },
    });
    if (existingEmail) {
      throw new ConflictException(`A user with email "${cleanEmail}" already exists in your business.`);
    }

    const existingPhone = await this.prisma.user.findFirst({
      where: { business_id: businessId, phone: cleanPhone, deleted_at: null },
    });
    if (existingPhone) {
      throw new ConflictException(`A user with phone "${cleanPhone}" already exists in your business.`);
    }

    // 3. Verify Role
    const role = await this.prisma.role.findFirst({
      where: {
        id: dto.roleId,
        OR: [{ business_id: businessId }, { business_id: null }],
      },
    });
    if (!role) {
      throw new NotFoundException(`Role with ID "${dto.roleId}" not found`);
    }

    // 4. Verify Branches
    if (!dto.branches || dto.branches.length === 0) {
      throw new BadRequestException('User must be assigned to at least one branch.');
    }

    const branchIds = dto.branches.map((b) => b.branchId);
    const validBranches = await this.prisma.branch.findMany({
      where: {
        id: { in: branchIds },
        business_id: businessId,
        is_active: true,
        deleted_at: null,
      },
    });

    if (validBranches.length !== branchIds.length) {
      throw new BadRequestException('One or more selected branches are invalid or inactive.');
    }

    // Ensure exactly one branch is marked default
    let defaultBranchId = dto.branches.find((b) => b.isDefault)?.branchId;
    if (!defaultBranchId) {
      defaultBranchId = dto.branches[0].branchId;
    }

    // 5. Hash Password
    const passwordHash = await bcrypt.hash(dto.password, 10);

    // 6. Create User & UserBranchAccess in Transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          business_id: businessId,
          first_name: dto.firstName.trim(),
          last_name: dto.lastName.trim(),
          email: cleanEmail,
          phone: cleanPhone,
          password_hash: passwordHash,
          role_id: role.id,
          is_owner: false,
          is_active: true,
        },
      });

      await tx.userBranchAccess.createMany({
        data: dto.branches.map((b) => ({
          business_id: businessId,
          user_id: user.id,
          branch_id: b.branchId,
          is_default: b.branchId === defaultBranchId,
        })),
      });

      await tx.auditLog.create({
        data: {
          business_id: businessId,
          user_id: actorUserId,
          action: 'CREATE',
          entity_table: 'users',
          entity_id: user.id,
          new_values: {
            firstName: user.first_name,
            lastName: user.last_name,
            email: user.email,
            phone: user.phone,
            roleId: user.role_id,
            branches: branchIds,
          },
        },
      });

      return user;
    });

    return this.getUser(businessId, result.id);
  }

  async updateUser(businessId: string, actorUserId: string, targetUserId: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findFirst({
      where: { id: targetUserId, business_id: businessId, deleted_at: null },
    });
    if (!user) {
      throw new NotFoundException(`User with ID "${targetUserId}" not found`);
    }

    if (dto.roleId && user.is_owner && dto.roleId !== user.role_id) {
      throw new BadRequestException('The primary business owner role cannot be changed.');
    }

    if (dto.email && dto.email.trim().toLowerCase() !== user.email.toLowerCase()) {
      const cleanEmail = dto.email.trim().toLowerCase();
      const existing = await this.prisma.user.findFirst({
        where: { business_id: businessId, email: cleanEmail, id: { not: targetUserId }, deleted_at: null },
      });
      if (existing) {
        throw new ConflictException(`Email "${cleanEmail}" is already used by another user.`);
      }
    }

    if (dto.phone && dto.phone.trim() !== user.phone) {
      const cleanPhone = dto.phone.trim();
      const existing = await this.prisma.user.findFirst({
        where: { business_id: businessId, phone: cleanPhone, id: { not: targetUserId }, deleted_at: null },
      });
      if (existing) {
        throw new ConflictException(`Phone "${cleanPhone}" is already used by another user.`);
      }
    }

    if (dto.roleId) {
      const role = await this.prisma.role.findFirst({
        where: { id: dto.roleId, OR: [{ business_id: businessId }, { business_id: null }] },
      });
      if (!role) {
        throw new NotFoundException(`Role with ID "${dto.roleId}" not found`);
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: targetUserId },
        data: {
          ...(dto.firstName ? { first_name: dto.firstName.trim() } : {}),
          ...(dto.lastName ? { last_name: dto.lastName.trim() } : {}),
          ...(dto.email ? { email: dto.email.trim().toLowerCase() } : {}),
          ...(dto.phone ? { phone: dto.phone.trim() } : {}),
          ...(dto.roleId ? { role_id: dto.roleId } : {}),
        },
      });

      await tx.auditLog.create({
        data: {
          business_id: businessId,
          user_id: actorUserId,
          action: 'UPDATE',
          entity_table: 'users',
          entity_id: targetUserId,
          old_values: {
            firstName: user.first_name,
            lastName: user.last_name,
            email: user.email,
            phone: user.phone,
            roleId: user.role_id,
          },
          new_values: {
            firstName: u.first_name,
            lastName: u.last_name,
            email: u.email,
            phone: u.phone,
            roleId: u.role_id,
          },
        },
      });

      return u;
    });

    return this.getUser(businessId, updated.id);
  }

  async updateStatus(businessId: string, actorUserId: string, targetUserId: string, isActive: boolean) {
    const user = await this.prisma.user.findFirst({
      where: { id: targetUserId, business_id: businessId, deleted_at: null },
    });
    if (!user) {
      throw new NotFoundException(`User with ID "${targetUserId}" not found`);
    }

    if (user.is_owner && !isActive) {
      throw new ForbiddenException('The business owner account cannot be deactivated.');
    }

    if (actorUserId === targetUserId && !isActive) {
      throw new ForbiddenException('You cannot deactivate your own account.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: targetUserId },
        data: { is_active: isActive },
      });

      // If deactivating, revoke all active sessions immediately
      if (!isActive) {
        await tx.userSession.updateMany({
          where: { user_id: targetUserId, is_revoked: false },
          data: { is_revoked: true },
        });
      }

      await tx.auditLog.create({
        data: {
          business_id: businessId,
          user_id: actorUserId,
          action: 'UPDATE',
          entity_table: 'users',
          entity_id: targetUserId,
          old_values: { isActive: user.is_active },
          new_values: { isActive },
        },
      });
    });

    return {
      success: true,
      message: `User "${user.first_name} ${user.last_name}" ${isActive ? 'reactivated' : 'deactivated'} successfully.`,
    };
  }

  async updateBranches(businessId: string, actorUserId: string, targetUserId: string, dto: UpdateUserBranchesDto) {
    const user = await this.prisma.user.findFirst({
      where: { id: targetUserId, business_id: businessId, deleted_at: null },
    });
    if (!user) {
      throw new NotFoundException(`User with ID "${targetUserId}" not found`);
    }

    if (!dto.branches || dto.branches.length === 0) {
      throw new BadRequestException('User must have access to at least one branch.');
    }

    const branchIds = dto.branches.map((b) => b.branchId);
    const validBranches = await this.prisma.branch.findMany({
      where: {
        id: { in: branchIds },
        business_id: businessId,
        is_active: true,
        deleted_at: null,
      },
    });

    if (validBranches.length !== branchIds.length) {
      throw new BadRequestException('One or more selected branches are invalid or inactive.');
    }

    let defaultBranchId = dto.branches.find((b) => b.isDefault)?.branchId;
    if (!defaultBranchId) {
      defaultBranchId = dto.branches[0].branchId;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userBranchAccess.deleteMany({
        where: { user_id: targetUserId, business_id: businessId },
      });

      await tx.userBranchAccess.createMany({
        data: dto.branches.map((b) => ({
          business_id: businessId,
          user_id: targetUserId,
          branch_id: b.branchId,
          is_default: b.branchId === defaultBranchId,
        })),
      });

      await tx.auditLog.create({
        data: {
          business_id: businessId,
          user_id: actorUserId,
          action: 'UPDATE',
          entity_table: 'user_branch_access',
          entity_id: targetUserId,
          new_values: { branches: dto.branches as any },
        },
      });
    });

    return this.getUser(businessId, targetUserId);
  }

  async resetPassword(businessId: string, actorUserId: string, targetUserId: string, newPassword: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: targetUserId, business_id: businessId, deleted_at: null },
    });
    if (!user) {
      throw new NotFoundException(`User with ID "${targetUserId}" not found`);
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: targetUserId },
        data: { password_hash: passwordHash },
      });

      // Revoke all sessions for target user so they re-authenticate
      await tx.userSession.updateMany({
        where: { user_id: targetUserId, is_revoked: false },
        data: { is_revoked: true },
      });

      await tx.auditLog.create({
        data: {
          business_id: businessId,
          user_id: actorUserId,
          action: 'UPDATE',
          entity_table: 'users',
          entity_id: targetUserId,
          new_values: { passwordReset: true },
        },
      });
    });

    return { success: true, message: 'Password reset successfully. The user must now log in with the new password.' };
  }
}
