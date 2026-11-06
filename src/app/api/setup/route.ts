// One-time setup for a fresh database: creates every table and loads the demo lender.
// Call GET /api/setup?key=<SETUP_KEY>. Does nothing if the database already has data.
import { gunzipSync } from 'node:zlib';
import { NextResponse } from 'next/server';
import { pool } from '@/db';
import { DEMO_SQL_GZ_B64 } from '@/db/demo-data';

export const dynamic = 'force-dynamic';
export const maxDuration = 26;

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get('key');
  const expected = process.env.SETUP_KEY || process.env.AUTH_SECRET;
  if (!expected || key !== expected) return NextResponse.json({ error: 'Wrong or missing setup key.' }, { status: 401 });

  const c = await pool.connect();
  try {
    const { rows } = await c.query(`select to_regclass('public.organizations') as t`);
    if (rows[0].t) {
      const n = await c.query('select count(*)::int as n from public.loans');
      return NextResponse.json({ ok: true, already: true, loans: n.rows[0].n, message: 'Database is already set up.' });
    }
    const sql = gunzipSync(Buffer.from(DEMO_SQL_GZ_B64, 'base64')).toString('utf8');
    const t0 = Date.now();
    await c.query('BEGIN');
    await c.query(sql);
    await c.query('COMMIT');
    const n = await c.query('select count(*)::int as n from public.loans');
    return NextResponse.json({ ok: true, loans: n.rows[0].n, seconds: (Date.now() - t0) / 1000, message: 'Demo lender loaded. Sign in with owner@finx.demo / finx1234.' });
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  } finally {
    c.release();
  }
}
