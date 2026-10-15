import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoleService } from './role.service.js';
import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';

describe('RoleService', () => {
  let service: RoleService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      role: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      permission: {
        findMany: vi.fn(),
      },
      rolePermission: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (cb) => cb(mockPrisma)),
    };

    service = new RoleService(mockPrisma);
  });

  it('should list roles with user counts and permissions', async () => {
    mockPrisma.role.findMany.mockResolvedValue([
      {
        id: 'role-1',
        name: 'Manager',
        code: 'MANAGER',
        description: null,
        is_system: true,
        role_permissions: [
          { permission: { id: 'p1', code: 'users:read', name: 'Read Users', module: 'Users' } },
        ],
        _count: { users: 3 },
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    const result = await service.listRoles('biz-1');
    expect(result).toHaveLength(1);
    expect(result[0].usersCount).toBe(3);
    expect(result[0].permissions).toHaveLength(1);
  });

  it('should throw ConflictException if creating role with duplicate code', async () => {
    mockPrisma.role.findFirst.mockResolvedValue({ id: 'existing' });

    await expect(
      service.createRole('biz-1', 'user-1', {
        name: 'Manager',
        code: 'MANAGER',
        permissionCodes: ['users:read'],
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('should throw BadRequestException when deleting a system role', async () => {
    mockPrisma.role.findFirst.mockResolvedValue({
      id: 'role-1',
      name: 'Owner',
      is_system: true,
      _count: { users: 1 },
    });

    await expect(service.deleteRole('biz-1', 'user-1', 'role-1')).rejects.toThrow(
      BadRequestException,
    );
  });
});
