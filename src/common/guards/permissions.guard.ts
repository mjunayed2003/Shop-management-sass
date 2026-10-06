import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import type { AuthenticatedUser } from '../decorators/current-user.decorator.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as any).user as AuthenticatedUser;

    if (!user) {
      return false;
    }

    // Business rule: Owner has full system access
    if (user.isOwner) {
      return true;
    }

    // Fetch user's role permissions
    const rolePermissions = await this.prisma.rolePermission.findMany({
      where: { role_id: user.roleId },
      include: { permission: true },
    });

    const userPermissionCodes = new Set(
      rolePermissions.map((rp) => rp.permission.code),
    );

    const hasPermission = (required: string): boolean => {
      if (userPermissionCodes.has(required)) return true;

      const colonForm = required.replace(/\./g, ':');
      const dotForm = required.replace(/:/g, '.');
      if (userPermissionCodes.has(colonForm) || userPermissionCodes.has(dotForm)) {
        return true;
      }

      const prefix = required.includes(':') ? required.split(':')[0] : required.split('.')[0];
      if (
        userPermissionCodes.has(`${prefix}:*`) ||
        userPermissionCodes.has(`${prefix}.*`) ||
        userPermissionCodes.has('*')
      ) {
        return true;
      }

      if (prefix === 'stock' || prefix === 'inventory') {
        const action = required.includes(':') ? required.split(':')[1] : required.split('.')[1];
        if (
          userPermissionCodes.has(`inventory:${action}`) ||
          userPermissionCodes.has(`inventory.${action}`) ||
          userPermissionCodes.has(`stock:${action}`) ||
          userPermissionCodes.has(`stock.${action}`) ||
          userPermissionCodes.has('inventory:*') ||
          userPermissionCodes.has('inventory.*') ||
          userPermissionCodes.has('stock:*') ||
          userPermissionCodes.has('stock.*')
        ) {
          return true;
        }
      }

      return false;
    };

    const missingPermissions = requiredPermissions.filter(
      (perm) => !hasPermission(perm),
    );

    if (missingPermissions.length > 0) {
      throw new ForbiddenException(
        `Insufficient permissions. Missing: [${missingPermissions.join(', ')}]`,
      );
    }

    return true;
  }
}
