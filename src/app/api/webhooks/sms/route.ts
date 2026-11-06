// Inbound SMS from your gateway: { from, text }
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { handleInbound } from '@/server/agent';

export async function POST(req: Request) {
  if (process.env.SMS_API_KEY && req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') !== process.env.SMS_API_KEY) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const orgId = new URL(req.url).searchParams.get('org') ?? (await db.query.organizations.findFirst())?.id;
  const b = await req.json();
  if (!orgId || !b.from || !b.text) return NextResponse.json({ error: 'from and text are required' }, { status: 400 });
  return NextResponse.json(await handleInbound(orgId, { channel: 'SMS', from: String(b.from), text: String(b.text) }));
}
