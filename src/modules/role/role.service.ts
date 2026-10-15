import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateRoleDto } from './dto/create-role.dto.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';
import { ALL_SYSTEM_PERMISSIONS } from '../../common/constants/permissions.constant.js';

@Injectable()
export class RoleService {
  constructor(private readonly prisma: PrismaService) {}

  async listRoles(businessId: string) {
    const roles = await this.prisma.role.findMany({
      where: {
        OR: [{ business_id: businessId }, { business_id: null }],
      },
      include: {
        role_permissions: {
          include: { permission: true },
        },
        _count: {
          select: {
            users: {
              where: {
                deleted_at: null,
              },
            },
          },
        },
      },
      orderBy: [{ is_system: 'desc' }, { created_at: 'asc' }],
    });

    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      code: role.code,
      description: role.description,
      isSystem: role.is_system,
      usersCount: role._count.users,
      permissionsCount: role.role_permissions.length,
      permissions: role.role_permissions.map((rp) => ({
        id: rp.permission.id,
        code: rp.permission.code,
        name: rp.permission.name,
        module: rp.permission.module,
      })),
      createdAt: role.created_at,
      updatedAt: role.updated_at,
    }));
  }

  async getRole(businessId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({
      where: {
        id: roleId,
        OR: [{ business_id: businessId }, { business_id: null }],
      },
      include: {
        role_permissions: {
          include: { permission: true },
        },
        _count: {
          select: {
            users: {
              where: { deleted_at: null },
            },
          },
        },
      },
    });

    if (!role) {
      throw new NotFoundException(`Role with ID "${roleId}" not found`);
    }

    return {
      id: role.id,
      name: role.name,
      code: role.code,
      description: role.description,
      isSystem: role.is_system,
      usersCount: role._count.users,
      permissionsCount: role.role_permissions.length,
      permissions: role.role_permissions.map((rp) => ({
        id: rp.permission.id,
        code: rp.permission.code,
        name: rp.permission.name,
        module: rp.permission.module,
      })),
      createdAt: role.created_at,
      updatedAt: role.updated_at,
    };
  }

  async createRole(businessId: string, userId: string, dto: CreateRoleDto) {
    const rawCode = dto.code
      ? dto.code.trim().toUpperCase()
      : dto.name.trim().toUpperCase().replace(/[^A-Z0-9]/g, '_');

    const existing = await this.prisma.role.findFirst({
      where: {
        business_id: businessId,
        code: rawCode,
      },
    });

    if (existing) {
      throw new ConflictException(`Role with code "${rawCode}" already exists in your business.`);
    }

    // Resolve permission IDs from codes or IDs
    const permissions = await this.prisma.permission.findMany({
      where: {
        OR: [
          { code: { in: dto.permissionCodes } },
          { id: { in: dto.permissionCodes } },
        ],
      },
    });

    if (permissions.length === 0) {
      throw new BadRequestException('At least one valid permission must be selected.');
    }

    const createdRole = await this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          business_id: businessId,
          name: dto.name.trim(),
          code: rawCode,
          description: dto.description?.trim() || null,
          is_system: false,
          role_permissions: {
            createMany: {
              data: permissions.map((p) => ({ permission_id: p.id })),
            },
          },
        },
        include: {
          role_permissions: {
            include: { permission: true },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          business_id: businessId,
          user_id: userId,
          action: 'CREATE',
          entity_table: 'roles',
          entity_id: role.id,
          new_values: {
            name: role.name,
            code: role.code,
            permissionCount: permissions.length,
          },
        },
      });

      return role;
    });

    return {
      id: createdRole.id,
      name: createdRole.name,
      code: createdRole.code,
      description: createdRole.description,
      isSystem: createdRole.is_system,
      permissionsCount: createdRole.role_permissions.length,
      permissions: createdRole.role_permissions.map((rp) => ({
        id: rp.permission.id,
        code: rp.permission.code,
        name: rp.permission.name,
        module: rp.permission.module,
      })),
      createdAt: createdRole.created_at,
      updatedAt: createdRole.updated_at,
    };
  }

  async updateRole(businessId: string, userId: string, roleId: string, dto: UpdateRoleDto) {
    const role = await this.prisma.role.findFirst({
      where: {
        id: roleId,
        OR: [{ business_id: businessId }, { business_id: null }],
      },
      include: {
        role_permissions: true,
      },
    });

    if (!role) {
      throw new NotFoundException(`Role with ID "${roleId}" not found`);
    }

    if (role.code === 'OWNER') {
      throw new BadRequestException('The system Owner role cannot be modified.');
    }

    let permissionIds: string[] | null = null;
    if (dto.permissionCodes) {
      const perms = await this.prisma.permission.findMany({
        where: {
          OR: [
            { code: { in: dto.permissionCodes } },
            { id: { in: dto.permissionCodes } },
          ],
        },
      });
      permissionIds = perms.map((p) => p.id);
    }

    const updatedRole = await this.prisma.$transaction(async (tx) => {
      // If permissionIds provided, update role permissions
      if (permissionIds) {
        await tx.rolePermission.deleteMany({
          where: { role_id: roleId },
        });

        await tx.rolePermission.createMany({
          data: permissionIds.map((pId) => ({
            role_id: roleId,
            permission_id: pId,
          })),
        });
      }

      const updated = await tx.role.update({
        where: { id: roleId },
        data: {
          ...(dto.name && !role.is_system ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        },
        include: {
          role_permissions: {
            include: { permission: true },
          },
          _count: {
            select: { users: { where: { deleted_at: null } } },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          business_id: businessId,
          user_id: userId,
          action: 'UPDATE',
          entity_table: 'roles',
          entity_id: roleId,
          old_values: {
            name: role.name,
            permissionCount: role.role_permissions.length,
          },
          new_values: {
            name: updated.name,
            permissionCount: updated.role_permissions.length,
          },
        },
      });

      return updated;
    });

    return {
      id: updatedRole.id,
      name: updatedRole.name,
      code: updatedRole.code,
      description: updatedRole.description,
      isSystem: updatedRole.is_system,
      usersCount: updatedRole._count.users,
      permissionsCount: updatedRole.role_permissions.length,
      permissions: updatedRole.role_permissions.map((rp) => ({
        id: rp.permission.id,
        code: rp.permission.code,
        name: rp.permission.name,
        module: rp.permission.module,
      })),
      createdAt: updatedRole.created_at,
      updatedAt: updatedRole.updated_at,
    };
  }

  async deleteRole(businessId: string, userId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, business_id: businessId },
      include: {
        _count: {
          select: { users: { where: { deleted_at: null } } },
        },
      },
    });

    if (!role) {
      throw new NotFoundException(`Custom role with ID "${roleId}" not found in your business.`);
    }

    if (role.is_system) {
      throw new BadRequestException('System default roles cannot be deleted.');
    }

    if (role._count.users > 0) {
      throw new ConflictException(
        `Cannot delete role "${role.name}" because it is currently assigned to ${role._count.users} user(s). Please reassign those users to another role first.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { role_id: roleId } });
      await tx.role.delete({ where: { id: roleId } });

      await tx.auditLog.create({
        data: {
          business_id: businessId,
          user_id: userId,
          action: 'DELETE',
          entity_table: 'roles',
          entity_id: roleId,
          old_values: { name: role.name, code: role.code },
        },
      });
    });

    return { success: true, message: `Role "${role.name}" deleted successfully.` };
  }

  async listPermissionsGrouped() {
    // Read from DB permissions table
    const perms = await this.prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { name: 'asc' }],
    });

    // If database permissions are not yet seeded, fallback to ALL_SYSTEM_PERMISSIONS constant
    const sourceList = perms.length > 0 ? perms : ALL_SYSTEM_PERMISSIONS.map((p, idx) => ({
      id: `system-perm-${idx}`,
      code: p.code,
      name: p.name,
      module: p.module,
      description: p.description,
    }));

    const grouped: Record<string, typeof sourceList> = {};
    for (const p of sourceList) {
      if (!grouped[p.module]) {
        grouped[p.module] = [];
      }
      grouped[p.module].push(p as any);
    }

    return Object.entries(grouped).map(([module, permissions]) => ({
      module,
      permissions,
    }));
  }
}
