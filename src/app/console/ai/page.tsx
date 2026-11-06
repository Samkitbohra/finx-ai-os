import { requireCtx } from '@/lib/auth';
import { threads } from '@/server/ai';
import { llmEnabled } from '@/lib/llm';
import { ChatUI } from './chat';

export const metadata = { title: 'FinX AI' };

export default async function AIPage({ searchParams }: { searchParams: Promise<{ q?: string; t?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const list = await threads(ctx);
  return <ChatUI threads={list.map((t) => ({ id: t.id, title: t.title }))} initialThread={sp.t} initialQuery={sp.q} name={ctx.name.split(' ')[0]} connected={llmEnabled()} />;
}
