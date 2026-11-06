import { NextResponse } from 'next/server';
import { getCtx } from '@/lib/auth';
import { chat, threadView } from '@/server/ai';

export const maxDuration = 60;

export async function GET(req: Request) {
  const ctx = await getCtx('CHAT');
  if (!ctx) return NextResponse.json({ error: 'Sign in' }, { status: 401 });
  const id = new URL(req.url).searchParams.get('thread');
  return NextResponse.json({ messages: id ? await threadView(ctx, id) : [] });
}

export async function POST(req: Request) {
  const ctx = await getCtx('CHAT');
  if (!ctx) return NextResponse.json({ error: 'Sign in' }, { status: 401 });
  const body = await req.json();
  try {
    const { threadId } = await chat(ctx, { threadId: body.threadId, message: body.message, confirm: body.confirm });
    return NextResponse.json({ threadId, messages: await threadView(ctx, threadId) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
