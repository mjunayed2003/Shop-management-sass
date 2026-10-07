import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { LoginLockoutService } from './login-lockout.service.js';

@Injectable()
export class AuthService {
  // In-memory OTP storage for forgot-password: identifier -> { otp, expiresAt }
  private readonly passwordResetOtps = new Map<string, { otp: string; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly loginLockoutService: LoginLockoutService,
  ) {}

  async login(dto: LoginDto, ipAddress?: string, userAgent?: string) {
    const identifier = dto.identifier.trim().toLowerCase();

    // 1. Check account lockout
    this.loginLockoutService.checkLockout(identifier, ipAddress);

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
      this.loginLockoutService.recordFailure(identifier, ipAddress);
      throw new UnauthorizedException('Invalid email/phone or password');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password_hash);
    if (!isPasswordValid) {
      this.loginLockoutService.recordFailure(identifier, ipAddress);
      throw new UnauthorizedException('Invalid email/phone or password');
    }

    // Success: reset lockout
    this.loginLockoutService.recordSuccess(identifier, ipAddress);

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

    const sub = user.business.subscription;
    const warning =
      sub && (sub.status === 'PAYMENT_DUE' || sub.status === 'GRACE')
        ? `Subscription status is ${sub.status}. Please renew your plan.`
        : null;

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
        warning,
      },
      branches: accessibleBranches,
    };
  }

  async getUserSessions(userId: string) {
    return this.prisma.userSession.findMany({
      where: {
        user_id: userId,
        is_revoked: false,
        expires_at: { gt: new Date() },
      },
      select: {
        id: true,
        ip_address: true,
        user_agent: true,
        created_at: true,
        expires_at: true,
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async revokeSession(userId: string, sessionId: string) {
    const session = await this.prisma.userSession.findFirst({
      where: { id: sessionId, user_id: userId },
    });
    if (!session) {
      throw new NotFoundException('Session not found.');
    }

    await this.prisma.userSession.update({
      where: { id: sessionId },
      data: { is_revoked: true },
    });

    return { success: true, message: 'Session revoked.' };
  }

  async logoutAllDevices(userId: string) {
    await this.prisma.userSession.updateMany({
      where: { user_id: userId, is_revoked: false },
      data: { is_revoked: true },
    });

    return { success: true, message: 'All active sessions revoked across devices.' };
  }

  async changePassword(userId: string, oldPass: string, newPass: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new NotFoundException('User not found.');

    const valid = await bcrypt.compare(oldPass, user.password_hash);
    if (!valid) throw new UnauthorizedException('Current password does not match.');

    const hashed = await bcrypt.hash(newPass, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password_hash: hashed },
    });

    return { message: 'Password changed successfully.' };
  }

  async forgotPassword(identifier: string) {
    const norm = identifier.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: norm, mode: 'insensitive' } },
          { phone: identifier.trim() },
        ],
        is_active: true,
        deleted_at: null,
      },
    });

    if (!user) {
      // Don't leak existence
      return { message: 'If an account exists, a password reset code has been sent.' };
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    this.passwordResetOtps.set(norm, {
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    });

    return {
      message: 'If an account exists, a password reset code has been sent.',
      testOtp: process.env.NODE_ENV !== 'production' ? otp : undefined,
    };
  }

  async resetPassword(identifier: string, otp: string, newPass: string) {
    const norm = identifier.trim().toLowerCase();
    const record = this.passwordResetOtps.get(norm);

    if (!record || Date.now() > record.expiresAt || record.otp !== otp.trim()) {
      throw new BadRequestException('Invalid or expired password reset OTP.');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: norm, mode: 'insensitive' } },
          { phone: identifier.trim() },
        ],
        is_active: true,
        deleted_at: null,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const hashed = await bcrypt.hash(newPass, 10);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { password_hash: hashed },
      });
      // Revoke all existing sessions
      await tx.userSession.updateMany({
        where: { user_id: user.id },
        data: { is_revoked: true },
      });
    });

    this.passwordResetOtps.delete(norm);
    return { message: 'Password reset successful. Please login with your new password.' };
  }
}
