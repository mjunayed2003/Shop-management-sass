import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Type helper to resolve Prisma 7 generic constructor inheritance in TypeScript
const BasePrismaClient = PrismaClient as unknown as new (options?: any) => PrismaClient;

@Injectable()
export class PrismaService extends BasePrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);

    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
    console.log('✅ Prisma Connected Successfully');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}