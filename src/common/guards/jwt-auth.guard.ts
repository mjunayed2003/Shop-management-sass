import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import type { AuthenticatedUser } from '../decorators/current-user.decorator.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
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
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const token = authHeader.split(' ')[1];

    let payload: { sub: string; businessId: string };
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET || 'super-secret-shop-jwt-key-2026',
      });
    } catch {
      throw new UnauthorizedException('Token is invalid or expired');
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');

    // Verify session
    const session = await this.prisma.userSession.findUnique({
      where: { token_hash: tokenHash },
    });

    if (!session || session.is_revoked || session.expires_at < new Date()) {
      throw new UnauthorizedException('Session is invalid, revoked, or expired');
    }

    // Load user and business subscription
    const user = await this.prisma.user.findFirst({
      where: {
        id: payload.sub,
        business_id: payload.businessId,
        is_active: true,
        deleted_at: null,
      },
      include: {
        business: {
          include: {
            subscription: true,
          },
        },
      },
    });

    if (!user || !user.business || !user.business.is_active || user.business.deleted_at !== null) {
      throw new UnauthorizedException('User account or business is deactivated');
    }

    // Business rule: Check subscription status (block SUSPENDED)
    const subscription = user.business.subscription;
    if (subscription && subscription.status === 'SUSPENDED') {
      throw new ForbiddenException(
        'Subscription is suspended. Please contact platform support or renew payment.',
      );
    }

    const authUser: AuthenticatedUser = {
      id: user.id,
      businessId: user.business_id,
      email: user.email,
      phone: user.phone,
      roleId: user.role_id,
      isOwner: user.is_owner,
      sessionId: session.id,
    };

    (request as any).user = authUser;

    return true;
  }
}
