import {
  Injectable,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OnboardBusinessDto } from './dto/onboard-business.dto.js';
import { PERMISSIONS } from '../../common/constants/permissions.constant.js';
import type { SequenceType } from '../../generated/prisma/client.js';

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async onboard(dto: OnboardBusinessDto, ipAddress?: string, userAgent?: string) {
    const slug = dto.businessSlug.trim().toLowerCase();

    // 1. Verify business slug uniqueness
    const existingBusiness = await this.prisma.business.findUnique({
      where: { slug },
    });
    if (existingBusiness) {
      throw new ConflictException(`Business with slug "${slug}" already exists`);
    }

    const ownerEmail = (dto.ownerEmail || dto.email).trim().toLowerCase();
    const ownerPhone = (dto.ownerPhone || dto.phone).trim();

    // 2. Fetch Selected Plan
    const planCode = (dto.planCode || 'STARTER').toUpperCase();
    const plan = await this.prisma.plan.findUnique({
      where: { code: planCode },
      include: { limits: true },
    });

    if (!plan) {
      throw new BadRequestException(
        `Subscription plan "${planCode}" was not found. Please choose STARTER or BUSINESS.`,
      );
    }

    // 3. Pre-fetch permissions list
    const allPermissions = await this.prisma.permission.findMany();
    if (allPermissions.length === 0) {
      throw new BadRequestException('System permissions are not seeded. Please run database seed.');
    }

    const managerDeniedCodes = new Set<string>([
      PERMISSIONS.ROLES_MANAGE,
      PERMISSIONS.BRANCHES_CREATE,
      PERMISSIONS.BRANCHES_DELETE,
      PERMISSIONS.BRANCHES_ASSIGN_USER,
      PERMISSIONS.USERS_DELETE,
      PERMISSIONS.EXPENSES_DELETE,
      PERMISSIONS.SALES_VOID,
    ]);

    const cashierAllowedCodes = new Set<string>([
      PERMISSIONS.POS_ACCESS,
      PERMISSIONS.SALES_CREATE,
      PERMISSIONS.SALES_READ,
      PERMISSIONS.SALES_RETURN,
      PERMISSIONS.SALES_EXCHANGE,
      PERMISSIONS.DUE_COLLECT,
      PERMISSIONS.CASH_REGISTER_OPEN_CLOSE,
      PERMISSIONS.CASH_REGISTER_VIEW,
      PERMISSIONS.CASH_MOVE,
      PERMISSIONS.PRODUCTS_READ,
      PERMISSIONS.INVENTORY_READ,
      PERMISSIONS.BARCODE_PRINT,
    ]);

    // 4. Calculate trial dates
    const trialDays = plan.trial_days || 30;
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

    // 5. Hash owner password
    const passwordHash = await bcrypt.hash(dto.password, 10);

    // 6. Execute entire onboarding inside a single ACID database transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // 6a. Create Business
      const business = await tx.business.create({
        data: {
          name: dto.businessName.trim(),
          slug,
          legal_name: dto.legalName?.trim() || null,
          phone: dto.phone.trim(),
          email: dto.email.trim().toLowerCase(),
          currency: dto.currency || 'BDT',
          timezone: dto.timezone || 'Asia/Dhaka',
          status: 'ACTIVE',
          is_active: true,
        },
      });

      // 6b. Create Subscription
      const subscription = await tx.subscription.create({
        data: {
          business_id: business.id,
          plan_id: plan.id,
          status: 'TRIAL',
          billing_cycle: 'MONTHLY',
          trial_starts_at: now,
          trial_ends_at: trialEndsAt,
          current_period_start: now,
          current_period_end: trialEndsAt,
          is_free_access: false,
        },
      });

      // 6c. Create Main Branch
      const branchCode = (dto.branchCode || 'MAIN').trim().toUpperCase();
      const mainBranch = await tx.branch.create({
        data: {
          business_id: business.id,
          name: dto.branchName.trim(),
          code: branchCode,
          address: dto.branchAddress.trim(),
          city: dto.branchCity?.trim() || 'Dhaka',
          phone: dto.branchPhone?.trim() || dto.phone.trim(),
          email: dto.email.trim().toLowerCase(),
          is_main: true,
          is_active: true,
        },
      });

      // 6d. Create Default Roles with permissions
      // Owner Role (gets all permissions)
      const ownerRole = await tx.role.create({
        data: {
          business_id: business.id,
          name: 'Owner',
          code: 'OWNER',
          description: 'Business owner with full administrative authority across all branches',
          is_system: true,
          role_permissions: {
            createMany: {
              data: allPermissions.map((p) => ({ permission_id: p.id })),
            },
          },
        },
      });

      // Manager Role
      const managerPerms = allPermissions.filter((p) => !managerDeniedCodes.has(p.code));
      await tx.role.create({
        data: {
          business_id: business.id,
          name: 'Store Manager',
          code: 'MANAGER',
          description: 'Branch store manager with inventory, catalog, and operations permissions',
          is_system: true,
          role_permissions: {
            createMany: {
              data: managerPerms.map((p) => ({ permission_id: p.id })),
            },
          },
        },
      });

      // Cashier Role
      const cashierPerms = allPermissions.filter((p) => cashierAllowedCodes.has(p.code));
      await tx.role.create({
        data: {
          business_id: business.id,
          name: 'POS Cashier',
          code: 'CASHIER',
          description: 'Front-desk point-of-sale checkout cashier',
          is_system: true,
          role_permissions: {
            createMany: {
              data: cashierPerms.map((p) => ({ permission_id: p.id })),
            },
          },
        },
      });

      // 6e. Create Owner User
      const ownerUser = await tx.user.create({
        data: {
          business_id: business.id,
          first_name: dto.ownerFirstName.trim(),
          last_name: dto.ownerLastName.trim(),
          email: ownerEmail,
          phone: ownerPhone,
          password_hash: passwordHash,
          role_id: ownerRole.id,
          is_owner: true,
          is_active: true,
        },
      });

      // 6f. Create UserBranchAccess for owner on main branch
      await tx.userBranchAccess.create({
        data: {
          business_id: business.id,
          user_id: ownerUser.id,
          branch_id: mainBranch.id,
          is_default: true,
        },
      });

      // 6g. Create InvoiceSequence rows for the main branch
      const sequences: { type: SequenceType; prefix: string }[] = [
        { type: 'SALE_INVOICE', prefix: 'INV-' },
        { type: 'PURCHASE_INVOICE', prefix: 'PO-' },
        { type: 'RETURN_INVOICE', prefix: 'RET-' },
        { type: 'TRANSFER_INVOICE', prefix: 'TRN-' },
        { type: 'JOURNAL_ENTRY', prefix: 'JE-' },
        { type: 'EXPENSE_VOUCHER', prefix: 'EXP-' },
      ];

      await tx.invoiceSequence.createMany({
        data: sequences.map((seq) => ({
          business_id: business.id,
          branch_id: mainBranch.id,
          sequence_type: seq.type,
          prefix: seq.prefix,
          next_number: 1,
        })),
      });

      // 6h. Create default CashRegister for the main branch
      const cashRegister = await tx.cashRegister.create({
        data: {
          business_id: business.id,
          branch_id: mainBranch.id,
          name: 'Counter 1',
          code: 'REG-01',
          is_active: true,
        },
      });

      // 6i. Create default Units, Sizes, Colors, ExpenseCategories
      await tx.unit.createMany({
        data: [
          { business_id: business.id, name: 'Piece', code: 'PCS', allow_decimal: false },
          { business_id: business.id, name: 'Dozen', code: 'DZN', allow_decimal: false },
          { business_id: business.id, name: 'Meter', code: 'MTR', allow_decimal: true },
          { business_id: business.id, name: 'Yard', code: 'YD', allow_decimal: true },
          { business_id: business.id, name: 'Set', code: 'SET', allow_decimal: false },
        ],
      });

      await tx.size.createMany({
        data: [
          { business_id: business.id, name: 'Small', code: 'S', sort_order: 1 },
          { business_id: business.id, name: 'Medium', code: 'M', sort_order: 2 },
          { business_id: business.id, name: 'Large', code: 'L', sort_order: 3 },
          { business_id: business.id, name: 'Extra Large', code: 'XL', sort_order: 4 },
          { business_id: business.id, name: 'Double Extra Large', code: 'XXL', sort_order: 5 },
          { business_id: business.id, name: 'Free Size', code: 'FREE', sort_order: 6 },
        ],
      });

      await tx.color.createMany({
        data: [
          { business_id: business.id, name: 'Black', code: 'BLK', hex_code: '#000000' },
          { business_id: business.id, name: 'White', code: 'WHT', hex_code: '#FFFFFF' },
          { business_id: business.id, name: 'Navy Blue', code: 'NVY', hex_code: '#000080' },
          { business_id: business.id, name: 'Maroon', code: 'MRN', hex_code: '#800000' },
          { business_id: business.id, name: 'Olive Green', code: 'OLV', hex_code: '#808000' },
          { business_id: business.id, name: 'Grey', code: 'GRY', hex_code: '#808080' },
        ],
      });

      await tx.expenseCategory.createMany({
        data: [
          { business_id: business.id, name: 'Showroom Rent', code: 'RENT' },
          { business_id: business.id, name: 'Electricity & Utilities', code: 'UTILITY' },
          { business_id: business.id, name: 'Staff Salary & Allowance', code: 'SALARY' },
          { business_id: business.id, name: 'Tea & Entertainment', code: 'ENTERTAINMENT' },
          { business_id: business.id, name: 'Stationery & Packaging', code: 'PACKAGING' },
          { business_id: business.id, name: 'Maintenance & Repairs', code: 'MAINTENANCE' },
        ],
      });

      return {
        business,
        subscription,
        mainBranch,
        ownerUser,
        cashRegister,
      };
    });

    // 7. Issue JWT and UserSession for instant login
    const jwtPayload = {
      sub: result.ownerUser.id,
      businessId: result.business.id,
      email: result.ownerUser.email,
      isOwner: true,
    };

    const accessToken = await this.jwtService.signAsync(jwtPayload, {
      secret: process.env.JWT_SECRET || 'super-secret-shop-jwt-key-2026',
      expiresIn: '7d',
    });

    const tokenHash = createHash('sha256').update(accessToken).digest('hex');
    const sessionExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const session = await this.prisma.userSession.create({
      data: {
        user_id: result.ownerUser.id,
        business_id: result.business.id,
        token_hash: tokenHash,
        ip_address: ipAddress || null,
        user_agent: userAgent || null,
        expires_at: sessionExpiresAt,
      },
    });

    return {
      message: 'Business onboarded successfully! Welcome to your Shop Management SaaS.',
      accessToken,
      session: {
        id: session.id,
        expiresAt: session.expires_at,
      },
      business: {
        id: result.business.id,
        name: result.business.name,
        slug: result.business.slug,
        phone: result.business.phone,
        email: result.business.email,
        currency: result.business.currency,
        timezone: result.business.timezone,
      },
      mainBranch: {
        id: result.mainBranch.id,
        name: result.mainBranch.name,
        code: result.mainBranch.code,
        address: result.mainBranch.address,
        isMain: true,
      },
      owner: {
        id: result.ownerUser.id,
        firstName: result.ownerUser.first_name,
        lastName: result.ownerUser.last_name,
        email: result.ownerUser.email,
        phone: result.ownerUser.phone,
        isOwner: true,
      },
      subscription: {
        plan: plan.name,
        code: plan.code,
        status: result.subscription.status,
        trialEndsAt: result.subscription.trial_ends_at,
      },
    };
  }
}
