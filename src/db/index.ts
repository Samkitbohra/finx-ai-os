import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const globalForDb = globalThis as unknown as { pool?: Pool; db?: NodePgDatabase<typeof schema> };

// DATABASE_URL, or the variable Netlify DB / Neon integrations set. channel_binding is dropped (node-postgres negotiates it).
const url = (process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL || process.env.POSTGRES_URL || '').replace(/[?&]channel_binding=[^&]*/, '');
const remote = /sslmode=require|neon\.tech|supabase|\.aws|render\.com/.test(url);

export const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: url.replace(/[?&]sslmode=[^&]*/, ''),
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
