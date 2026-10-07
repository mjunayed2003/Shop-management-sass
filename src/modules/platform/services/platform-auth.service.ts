import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { SuperAdminRole } from '../../../generated/prisma/client.js';

@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(email: string, pass: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const admin = await this.prisma.superAdmin.findUnique({
      where: { email: normalizedEmail },
    });

    if (!admin || !admin.is_active) {
      throw new UnauthorizedException('Invalid platform credentials or account is inactive.');
    }

    const valid = await bcrypt.compare(pass, admin.password_hash);
    if (!valid) {
      throw new UnauthorizedException('Invalid platform credentials.');
    }

    await this.prisma.superAdmin.update({
      where: { id: admin.id },
      data: { last_login_at: new Date() },
    });

    const payload = {
      sub: admin.id,
      aud: 'platform',
      role: admin.role,
      email: admin.email,
    };

    const token = await this.jwtService.signAsync(payload, {
      secret: process.env.JWT_SECRET || 'super-secret-shop-jwt-key-2026',
      expiresIn: '24h',
    });

    return {
      accessToken: token,
      tokenType: 'Bearer',
      expiresIn: '24h',
      admin: {
        id: admin.id,
        email: admin.email,
        firstName: admin.first_name,
        lastName: admin.last_name,
        role: admin.role,
      },
    };
  }

  async changePassword(adminId: string, oldPass: string, newPass: string) {
    const admin = await this.prisma.superAdmin.findUnique({
      where: { id: adminId },
    });
    if (!admin) {
      throw new NotFoundException('Platform admin not found.');
    }

    const valid = await bcrypt.compare(oldPass, admin.password_hash);
    if (!valid) {
      throw new UnauthorizedException('Current password does not match.');
    }

    const hashed = await bcrypt.hash(newPass, 10);
    await this.prisma.superAdmin.update({
      where: { id: adminId },
      data: { password_hash: hashed },
    });

    return { message: 'Password changed successfully.' };
  }

  async createAdmin(creatorRole: SuperAdminRole, dto: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
    role?: SuperAdminRole;
  }) {
    if (creatorRole !== SuperAdminRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only SUPER_ADMIN can create platform administrators.');
    }

    const normalizedEmail = dto.email.trim().toLowerCase();
    const existing = await this.prisma.superAdmin.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      throw new ConflictException(`Platform admin with email "${dto.email}" already exists.`);
    }

    const hashed = await bcrypt.hash(dto.password, 10);
    const created = await this.prisma.superAdmin.create({
      data: {
        email: normalizedEmail,
        password_hash: hashed,
        first_name: dto.firstName,
        last_name: dto.lastName,
        phone: dto.phone || null,
        role: dto.role || SuperAdminRole.PLATFORM_SUPPORT,
      },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        role: true,
        is_active: true,
        created_at: true,
      },
    });

    return created;
  }

  async listAdmins() {
    return this.prisma.superAdmin.findMany({
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        phone: true,
        role: true,
        is_active: true,
        last_login_at: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async updateAdmin(
    creatorRole: SuperAdminRole,
    targetAdminId: string,
    dto: { role?: SuperAdminRole; isActive?: boolean },
  ) {
    if (creatorRole !== SuperAdminRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only SUPER_ADMIN can modify platform administrators.');
    }

    const target = await this.prisma.superAdmin.findUnique({
      where: { id: targetAdminId },
    });
    if (!target) {
      throw new NotFoundException('Platform admin not found.');
    }

    return this.prisma.superAdmin.update({
      where: { id: targetAdminId },
      data: {
        role: dto.role ?? target.role,
        is_active: dto.isActive ?? target.is_active,
      },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        role: true,
        is_active: true,
      },
    });
  }
}
