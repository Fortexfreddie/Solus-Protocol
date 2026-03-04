/**
 * db.ts
 * Prisma client singleton with lazy initialisation.
 *
 * Dual-mode connection strategy:
 *   - production  → Supabase PostgreSQL via PgBouncer (POOLER_URL on port 6543)
 *   - development → Local PostgreSQL (DATABASE_URL on port 5432)
 *
 * The Prisma client is lazily created on first call to getPrisma().
 * In development mode, no DB connection is established unless a feature
 * explicitly requests it — filesystem storage is the default.
 *
 * Environment variables:
 *   DATABASE_URL  — Local dev connection string (used by Prisma CLI + dev runtime)
 *   DIRECT_URL    — Supabase direct connection (used by Prisma migrations, bypasses PgBouncer)
 *   POOLER_URL    — Supabase pooled connection (used by app runtime in production)
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

//  Environment 

export const isProduction = process.env.NODE_ENV === 'production';

//  Lazy singleton 

let _prisma: PrismaClient | null = null;

/**
 * Returns the shared PrismaClient singleton.
 * Creates the client on first call — dev mode never hits this unless
 * a feature explicitly needs the database.
 *
 * In production: uses POOLER_URL (Supabase PgBouncer for connection pooling)
 * In development: uses DATABASE_URL (local Postgres)
 */
export function getPrisma(): PrismaClient {
  if (!_prisma) {
    const connectionString = isProduction
      ? process.env.POOLER_URL
      : process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error(
        `[DB] Missing connection string. ` +
        `Set ${isProduction ? 'POOLER_URL' : 'DATABASE_URL'} in your .env file.`,
      );
    }

    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    _prisma = new PrismaClient({ adapter });
  }
  return _prisma;
}

/**
 * Disconnects the Prisma client if it was initialised.
 * Called during graceful shutdown.
 */
export async function disconnectPrisma(): Promise<void> {
  if (_prisma) {
    await _prisma.$disconnect();
    _prisma = null;
  }
}