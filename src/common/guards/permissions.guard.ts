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
    const url = request.url || '';
    if (url.startsWith('/platform')) {
      return true;
    }

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

      if (prefix === 'sale' || prefix === 'sales') {
        const action = required.includes(':') ? required.split(':')[1] : required.split('.')[1];
        if (
          userPermissionCodes.has(`sales:${action}`) ||
          userPermissionCodes.has(`sales.${action}`) ||
          userPermissionCodes.has(`sale:${action}`) ||
          userPermissionCodes.has(`sale.${action}`) ||
          userPermissionCodes.has('sales:*') ||
          userPermissionCodes.has('sales.*') ||
          userPermissionCodes.has('sale:*') ||
          userPermissionCodes.has('sale.*')
        ) {
          return true;
        }
      }

      if (prefix === 'customer' || prefix === 'customers') {
        const action = required.includes(':') ? required.split(':')[1] : required.split('.')[1];
        if (
          userPermissionCodes.has(`customers:${action}`) ||
          userPermissionCodes.has(`customers.${action}`) ||
          userPermissionCodes.has(`customer:${action}`) ||
          userPermissionCodes.has(`customer.${action}`) ||
          userPermissionCodes.has('customers:*') ||
          userPermissionCodes.has('customer:*')
        ) {
          return true;
        }
      }

      if (prefix === 'return' || prefix === 'sales_return') {
        const action = required.includes(':') ? required.split(':')[1] : required.split('.')[1];
        if (
          (action === 'create' && (userPermissionCodes.has('sales:return') || userPermissionCodes.has('sales.return'))) ||
          (action === 'cross_branch' && (userPermissionCodes.has('sale:cross_branch') || userPermissionCodes.has('sales:cross_branch'))) ||
          userPermissionCodes.has(`return:${action}`) ||
          userPermissionCodes.has(`return.${action}`) ||
          userPermissionCodes.has('return:*') ||
          userPermissionCodes.has('sales:return')
        ) {
          return true;
        }
      }

      if (prefix === 'exchange') {
        const action = required.includes(':') ? required.split(':')[1] : required.split('.')[1];
        if (
          (action === 'create' && (userPermissionCodes.has('sales:exchange') || userPermissionCodes.has('sales.exchange'))) ||
          userPermissionCodes.has(`exchange:${action}`) ||
          userPermissionCodes.has(`exchange.${action}`) ||
          userPermissionCodes.has('exchange:*') ||
          userPermissionCodes.has('sales:exchange')
        ) {
          return true;
        }
      }

      if (prefix === 'expense' || prefix === 'expenses') {
        const action = required.includes(':') ? required.split(':')[1] : required.split('.')[1];
        if (
          ((action === 'view' || action === 'read') && (userPermissionCodes.has('expenses:read') || userPermissionCodes.has('expenses.read') || userPermissionCodes.has('expense:view') || userPermissionCodes.has('expense.view'))) ||
          (action === 'create' && (userPermissionCodes.has('expenses:create') || userPermissionCodes.has('expenses.create') || userPermissionCodes.has('expense:create') || userPermissionCodes.has('expense.create'))) ||
          (action === 'update' && (userPermissionCodes.has('expenses:update') || userPermissionCodes.has('expenses.update') || userPermissionCodes.has('expense:update') || userPermissionCodes.has('expense.update'))) ||
          (action === 'delete' && (userPermissionCodes.has('expenses:delete') || userPermissionCodes.has('expenses.delete') || userPermissionCodes.has('expense:delete') || userPermissionCodes.has('expense.delete'))) ||
          userPermissionCodes.has(`expenses:${action}`) ||
          userPermissionCodes.has(`expense:${action}`) ||
          userPermissionCodes.has('expenses:*') ||
          userPermissionCodes.has('expense:*')
        ) {
          return true;
        }
      }

      if (prefix === 'report' || prefix === 'reports') {
        const action = required.includes(':') ? required.split(':')[1] : required.split('.')[1];
        if (
          ((action === 'view' || action === 'read') && (userPermissionCodes.has('reports:view') || userPermissionCodes.has('reports.view') || userPermissionCodes.has('report:view') || userPermissionCodes.has('report.view'))) ||
          userPermissionCodes.has(`reports:${action}`) ||
          userPermissionCodes.has(`report:${action}`) ||
          userPermissionCodes.has('reports:*') ||
          userPermissionCodes.has('report:*')
        ) {
          return true;
        }
      }

      if (prefix === 'register' || prefix === 'cash_register') {
        const action = required.includes(':') ? required.split(':')[1] : required.split('.')[1];
        if (
          (action === 'close' && (userPermissionCodes.has('cash_register:open_close') || userPermissionCodes.has('cash_register.open_close'))) ||
          userPermissionCodes.has(`cash_register:${action}`) ||
          userPermissionCodes.has(`cash_register.${action}`) ||
          userPermissionCodes.has(`register:${action}`) ||
          userPermissionCodes.has(`register.${action}`) ||
          userPermissionCodes.has('cash_register:*') ||
          userPermissionCodes.has('register:*')
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
