import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';
import { ALL_SYSTEM_PERMISSIONS } from '../src/common/constants/permissions.constant.js';

dotenv.config();

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new (PrismaClient as unknown as new (opts?: any) => PrismaClient)({ adapter });

async function seed() {
  console.log('🌱 Starting database seed...');

  // 1. Seed Permissions
  console.log('📌 Seeding permissions...');
  for (const perm of ALL_SYSTEM_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: perm.code },
      update: {
        name: perm.name,
        module: perm.module,
        description: perm.description,
      },
      create: {
        name: perm.name,
        code: perm.code,
        module: perm.module,
        description: perm.description,
      },
    });
  }
  console.log(`✅ Seeded ${ALL_SYSTEM_PERMISSIONS.length} permissions.`);

  // 2. Seed SuperAdmin
  console.log('📌 Seeding SuperAdmin...');
  const superAdminEmail = 'admin@pos.com';
  const hashedPassword = await bcrypt.hash('SuperAdmin123!', 10);

  const superAdmin = await prisma.superAdmin.upsert({
    where: { email: superAdminEmail },
    update: {
      first_name: 'Super',
      last_name: 'Admin',
      phone: '+8801700000000',
      role: 'SUPER_ADMIN',
      is_active: true,
    },
    create: {
      email: superAdminEmail,
      password_hash: hashedPassword,
      first_name: 'Super',
      last_name: 'Admin',
      phone: '+8801700000000',
      role: 'SUPER_ADMIN',
      is_active: true,
    },
  });
  console.log(`✅ Seeded SuperAdmin: ${superAdmin.email}`);

  // 3. Seed Plans & PlanLimits
  console.log('📌 Seeding Plans & Limits...');
  const starterPlan = await prisma.plan.upsert({
    where: { code: 'STARTER' },
    update: {
      name: 'Starter Boutique Plan',
      description: 'Single showroom clothing boutiques starting out',
      monthly_price: 1500.0,
      yearly_price: 15000.0,
      trial_days: 30,
      is_active: true,
    },
    create: {
      name: 'Starter Boutique Plan',
      code: 'STARTER',
      description: 'Single showroom clothing boutiques starting out',
      monthly_price: 1500.0,
      yearly_price: 15000.0,
      trial_days: 30,
      is_active: true,
    },
  });

  await prisma.planLimit.upsert({
    where: { plan_id: starterPlan.id },
    update: {
      max_branches: 1,
      max_users: 3,
      max_products: 500,
      max_variants: 1500,
      max_monthly_invoices: 1000,
      has_api_access: false,
      has_custom_reports: false,
      has_offline_sync: true,
    },
    create: {
      plan_id: starterPlan.id,
      max_branches: 1,
      max_users: 3,
      max_products: 500,
      max_variants: 1500,
      max_monthly_invoices: 1000,
      has_api_access: false,
      has_custom_reports: false,
      has_offline_sync: true,
    },
  });
  console.log(`✅ Seeded Plan: ${starterPlan.name} (${starterPlan.code})`);

  const businessPlan = await prisma.plan.upsert({
    where: { code: 'BUSINESS' },
    update: {
      name: 'Business Growth Plan',
      description: 'Multi-branch apparel retail chain with high sales volume and multi-store inventory',
      monthly_price: 3500.0,
      yearly_price: 35000.0,
      trial_days: 30,
      is_active: true,
    },
    create: {
      name: 'Business Growth Plan',
      code: 'BUSINESS',
      description: 'Multi-branch apparel retail chain with high sales volume and multi-store inventory',
      monthly_price: 3500.0,
      yearly_price: 35000.0,
      trial_days: 30,
      is_active: true,
    },
  });

  await prisma.planLimit.upsert({
    where: { plan_id: businessPlan.id },
    update: {
      max_branches: 5,
      max_users: 15,
      max_products: 5000,
      max_variants: 25000,
      max_monthly_invoices: 10000,
      has_api_access: true,
      has_custom_reports: true,
      has_offline_sync: true,
    },
    create: {
      plan_id: businessPlan.id,
      max_branches: 5,
      max_users: 15,
      max_products: 5000,
      max_variants: 25000,
      max_monthly_invoices: 10000,
      has_api_access: true,
      has_custom_reports: true,
      has_offline_sync: true,
    },
  });
  console.log(`✅ Seeded Plan: ${businessPlan.name} (${businessPlan.code})`);

  console.log('🎉 Database seeding completed successfully!');
}

seed()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
