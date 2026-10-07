import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator.js';
import { PLATFORM_ROLES_KEY } from './platform-roles.decorator.js';
import { SuperAdminRole } from '../../../generated/prisma/client.js';

export interface AuthenticatedSuperAdmin {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: SuperAdminRole;
}

@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
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

    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header for platform access');
    }

    const token = authHeader.split(' ')[1];

    let payload: { sub: string; aud: string; role: SuperAdminRole };
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET || 'super-secret-shop-jwt-key-2026',
      });
    } catch {
      throw new UnauthorizedException('Platform token is invalid or expired');
    }

    // Strict audience check: platform tokens only!
    if (payload.aud !== 'platform') {
      throw new UnauthorizedException('Access denied: Tenant tokens cannot access platform endpoints.');
    }

    const superAdmin = await this.prisma.superAdmin.findUnique({
      where: { id: payload.sub },
    });

    if (!superAdmin || !superAdmin.is_active) {
      throw new UnauthorizedException('Platform admin account is inactive or not found.');
    }

    // Role check if specified on handler/class
    const requiredRoles = this.reflector.getAllAndOverride<SuperAdminRole[]>(
      PLATFORM_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (requiredRoles && requiredRoles.length > 0) {
      if (!requiredRoles.includes(superAdmin.role)) {
        throw new ForbiddenException(
          `Action requires platform role: [${requiredRoles.join(', ')}]. Current role: ${superAdmin.role}.`,
        );
      }
    }

    (request as any).superAdmin = {
      id: superAdmin.id,
      email: superAdmin.email,
      firstName: superAdmin.first_name,
      lastName: superAdmin.last_name,
      role: superAdmin.role,
    };

    return true;
  }
}
