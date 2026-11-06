// Daily job (07:30 IST): refresh days-past-due and scores, expire overdue KYC, and run the collections agent.
// Call with Authorization: Bearer $CRON_SECRET (Vercel Cron sends it automatically).
import { NextResponse } from 'next/server';
import { and, eq, lt } from 'drizzle-orm';
import { db, schema } from '@/db';
import { refreshPortfolio } from '@/server/loans';
import { runCollections } from '@/server/agent';

export const maxDuration = 300;

export async function GET(req: Request) {
  if (process.env.CRON_SECRET && req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const orgs = await db.select().from(schema.organizations);
  const report = [];
  for (const org of orgs) {
    const changed = await refreshPortfolio(org.id);
    const expired = await db.update(schema.borrowers).set({ kycStatus: 'EXPIRED' }).where(and(eq(schema.borrowers.orgId, org.id), eq(schema.borrowers.kycStatus, 'VERIFIED'), lt(schema.borrowers.kycDueAt, new Date()))).returning({ id: schema.borrowers.id });
    const run = new URL(req.url).searchParams.get('collections') === '0' ? null : await runCollections({ orgId: org.id, userId: null, role: 'ADMIN', branchId: null, name: 'Daily run', via: 'AGENT' });
    report.push({ org: org.name, dpdUpdated: changed, kycExpired: expired.length, collections: run && { planned: run.planned, sent: run.sent, heldBack: run.blocked } });
  }
  return NextResponse.json({ ok: true, report });
}
