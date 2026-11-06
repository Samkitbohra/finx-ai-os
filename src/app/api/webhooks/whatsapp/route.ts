// Meta WhatsApp Cloud API webhook: verification, delivery/read receipts, and inbound replies.
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { handleInbound } from '@/server/agent';

const orgFor = async (req: Request) => new URL(req.url).searchParams.get('org') ?? (await db.query.organizations.findFirst())?.id;

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  if (u.get('hub.mode') === 'subscribe' && u.get('hub.verify_token') === process.env.WHATSAPP_VERIFY_TOKEN) return new NextResponse(u.get('hub.challenge'));
  return new NextResponse('Forbidden', { status: 403 });
}

export async function POST(req: Request) {
  const orgId = await orgFor(req);
  if (!orgId) return NextResponse.json({ ok: false });
  const body = await req.json();
  for (const entry of body.entry ?? []) for (const ch of entry.changes ?? []) {
    const v = ch.value ?? {};
    for (const st of v.statuses ?? []) {
      const status = st.status === 'read' ? 'READ' : st.status === 'delivered' ? 'DELIVERED' : st.status === 'failed' ? 'FAILED' : null;
      if (status) await db.update(schema.communications).set({ status }).where(eq(schema.communications.providerRef, st.id));
    }
    for (const m of v.messages ?? []) if (m.type === 'text') await handleInbound(orgId, { channel: 'WHATSAPP', from: m.from, text: m.text.body });
  }
  return NextResponse.json({ ok: true });
}
