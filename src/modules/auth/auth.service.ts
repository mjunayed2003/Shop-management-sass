import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto, ipAddress?: string, userAgent?: string) {
    const identifier = dto.identifier.trim().toLowerCase();

    let businessId: string | undefined;
    if (dto.businessSlug) {
      const business = await this.prisma.business.findUnique({
        where: { slug: dto.businessSlug.trim().toLowerCase() },
      });
      if (!business) {
        throw new NotFoundException(`Business with slug "${dto.businessSlug}" not found`);
      }
      businessId = business.id;
    }

    // Find user by email or phone
    const user = await this.prisma.user.findFirst({
      where: {
        AND: [
          businessId ? { business_id: businessId } : {},
          {
            OR: [
              { email: { equals: identifier, mode: 'insensitive' } },
              { phone: dto.identifier.trim() },
            ],
          },
          { is_active: true },
          { deleted_at: null },
        ],
      },
      include: {
        business: {
          include: {
            subscription: {
              include: {
                plan: {
                  include: { limits: true },
                },
              },
            },
          },
        },
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

    if (!user) {
      throw new UnauthorizedException('Invalid email/phone or password');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password_hash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email/phone or password');
    }

    // Check Business & Subscription status
    if (!user.business.is_active || user.business.deleted_at !== null) {
      throw new ForbiddenException('Your business account has been deactivated');
    }

    const subscription = user.business.subscription;
    if (subscription && subscription.status === 'SUSPENDED') {
      throw new ForbiddenException(
        'Subscription is suspended. Please contact platform support or renew payment.',
      );
    }

    // Sign JWT
    const payload = {
      sub: user.id,
      businessId: user.business_id,
      email: user.email,
      isOwner: user.is_owner,
    };

    const token = await this.jwtService.signAsync(payload, {
      secret: process.env.JWT_SECRET || 'super-secret-shop-jwt-key-2026',
      expiresIn: '7d',
    });

    // Hash token and store session
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.userSession.create({
      data: {
        user_id: user.id,
        business_id: user.business_id,
        token_hash: tokenHash,
        ip_address: ipAddress || null,
        user_agent: userAgent || null,
        expires_at: expiresAt,
        is_revoked: false,
      },
    });

    // Determine available branches
    let accessibleBranches: any[] = [];
    if (user.is_owner) {
      accessibleBranches = await this.prisma.branch.findMany({
        where: { business_id: user.business_id, is_active: true, deleted_at: null },
      });
    } else {
      accessibleBranches = user.user_branch_access
        .filter((uba) => uba.branch.is_active && uba.branch.deleted_at === null)
        .map((uba) => ({
          ...uba.branch,
          is_default: uba.is_default,
        }));
    }

    const permissions = user.is_owner
      ? ['*']
      : user.role.role_permissions.map((rp) => rp.permission.code);

    return {
      accessToken: token,
      tokenType: 'Bearer',
      expiresIn: '7d',
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone: user.phone,
        isOwner: user.is_owner,
        role: {
          id: user.role.id,
          name: user.role.name,
          code: user.role.code,
        },
        permissions,
      },
      business: {
        id: user.business.id,
        name: user.business.name,
        slug: user.business.slug,
        currency: user.business.currency,
        timezone: user.business.timezone,
        subscription: subscription
          ? {
              status: subscription.status,
              planName: subscription.plan.name,
              trialEndsAt: subscription.trial_ends_at,
              currentPeriodEnd: subscription.current_period_end,
              limits: subscription.plan.limits,
            }
          : null,
      },
      branches: accessibleBranches,
    };
  }

  async logout(user: AuthenticatedUser) {
    await this.prisma.userSession.update({
      where: { id: user.sessionId },
      data: { is_revoked: true },
    });
    return { success: true, message: 'Logged out successfully' };
  }

  async getProfile(userId: string, businessId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, business_id: businessId, is_active: true, deleted_at: null },
      include: {
        business: {
          include: {
            subscription: {
              include: { plan: { include: { limits: true } } },
            },
          },
        },
        role: {
          include: {
            role_permissions: {
              include: { permission: true },
            },
          },
        },
        user_branch_access: {
          include: { branch: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User profile not found');
    }

    let accessibleBranches: any[] = [];
    if (user.is_owner) {
      accessibleBranches = await this.prisma.branch.findMany({
        where: { business_id: user.business_id, is_active: true, deleted_at: null },
      });
    } else {
      accessibleBranches = user.user_branch_access
        .filter((uba) => uba.branch.is_active && uba.branch.deleted_at === null)
        .map((uba) => ({
          ...uba.branch,
          is_default: uba.is_default,
        }));
    }

    return {
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone: user.phone,
        isOwner: user.is_owner,
        role: {
          id: user.role.id,
          name: user.role.name,
          code: user.role.code,
        },
        permissions: user.is_owner
          ? ['*']
          : user.role.role_permissions.map((rp) => rp.permission.code),
      },
      business: {
        id: user.business.id,
        name: user.business.name,
        slug: user.business.slug,
        subscription: user.business.subscription,
      },
      branches: accessibleBranches,
    };
  }
}
