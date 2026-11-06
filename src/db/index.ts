import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const globalForDb = globalThis as unknown as { pool?: Pool; db?: NodePgDatabase<typeof schema> };

// DATABASE_URL, or the variable Netlify Database (NETLIFY_DB_URL) / other integrations set. channel_binding is dropped (node-postgres negotiates it).
const raw = process.env.DATABASE_URL || process.env.NETLIFY_DB_URL || process.env.NETLIFY_DATABASE_URL || process.env.POSTGRES_URL || '';
function clean(u: string) {
  try { const x = new URL(u); x.searchParams.delete('sslmode'); x.searchParams.delete('channel_binding'); return x.toString(); } catch { return u; }
}
const remote = !!raw && !/@(localhost|127\.0\.0\.1)[:/]/.test(raw);

export const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: clean(raw),
    max: remote ? 3 : 10,
    ssl: remote ? { rejectUnauthorized: false } : undefined,
  });

export const db = globalForDb.db ?? drizzle(pool, { schema });
if (process.env.NODE_ENV !== 'production') {
  globalForDb.pool = pool;
  globalForDb.db = db;
}
export type DB = typeof db;
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export { schema };
