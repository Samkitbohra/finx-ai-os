// Voice-agent provider callback: { ref, outcome, transcript, ptp_date, ptp_amount, duration_sec }
// `ref` is the communication id FinX sent with the call request. Protected by VOICE_PROVIDER_KEY.
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { logOutcome } from '@/server/agent';

const OUTCOMES = ['PROMISE_TO_PAY', 'PAID', 'NO_ANSWER', 'CALLBACK', 'DISPUTE', 'ESCALATED', 'WRONG_NUMBER', 'INFO_ONLY'];

export async function POST(req: Request) {
  const key = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (process.env.VOICE_PROVIDER_KEY && key !== process.env.VOICE_PROVIDER_KEY) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json();
  const c = await db.query.communications.findFirst({ where: eq(schema.communications.id, String(b.ref)) });
  if (!c) return NextResponse.json({ error: 'Unknown ref' }, { status: 404 });
  const outcome = OUTCOMES.includes(String(b.outcome).toUpperCase()) ? String(b.outcome).toUpperCase() : 'INFO_ONLY';
  await logOutcome({ orgId: c.orgId, userId: null, role: 'ADMIN', branchId: null, name: 'Voice agent', via: 'AGENT' }, c.id, {
    outcome: outcome as never, transcript: b.transcript, ptpDate: b.ptp_date, ptpAmount: b.ptp_amount != null ? Number(b.ptp_amount) : undefined, durationSec: b.duration_sec != null ? Number(b.duration_sec) : undefined,
  });
  return NextResponse.json({ ok: true });
}
