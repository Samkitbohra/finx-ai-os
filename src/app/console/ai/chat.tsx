'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { I } from '@/components/icons';

type Msg = { id: string; role: 'user' | 'assistant'; text: string; tools: string[]; pending?: { summary: string; tool: string } };

const SUGGEST = [
  ['Ask', 'Who is 30 days late?'],
  ['Ask', 'How is the portfolio doing this month?'],
  ['Create', 'Add Fathima Begum, 98400 12345, Tamil — then a jewel loan of ₹45,000 against 22 g of 22K gold for 6 months'],
  ['Invoice', 'Invoice 12 has the wrong GST. Re-issue it at 18%.'],
  ['Ledger', 'Does the trial balance tie out? Anything unreconciled?'],
  ['Collect', 'Send an overdue reminder on WhatsApp to the borrower of the most overdue gold loan'],
];

/** Tiny, safe markdown: **bold**, - lists, line breaks, and loan links. */
function Md({ text }: { text: string }) {
  const lines = text.split('\n');
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  const inline = (s: string, k: number) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => p.startsWith('**') ? <strong key={`${k}-${i}`} className="font-semibold text-ink">{p.slice(2, -2)}</strong> : <span key={`${k}-${i}`}>{p}</span>);
  const flush = () => { if (list.length) { out.push(<ul key={`l${out.length}`} className="my-1.5 list-disc space-y-1 pl-5">{list.map((l, i) => <li key={i}>{inline(l, i)}</li>)}</ul>); list = []; } };
  lines.forEach((l, i) => {
    if (/^\s*[-•*]\s+/.test(l)) list.push(l.replace(/^\s*[-•*]\s+/, ''));
    else { flush(); if (l.trim()) out.push(<p key={i} className="my-1">{inline(l.replace(/^#+\s*/, ''), i)}</p>); }
  });
  flush();
  return <div className="text-sm leading-relaxed text-dim">{out}</div>;
}

export function ChatUI({ threads, initialThread, initialQuery, name, connected }: { threads: { id: string; title: string }[]; initialThread?: string; initialQuery?: string; name: string; connected: boolean }) {
  const [thread, setThread] = useState<string | undefined>(initialThread);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const sentQ = useRef(false);

  useEffect(() => { if (thread) fetch(`/api/chat?thread=${thread}`).then((r) => r.json()).then((d) => setMsgs(d.messages ?? [])); else setMsgs([]); }, [thread]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy]);
  useEffect(() => { if (initialQuery && !sentQ.current) { sentQ.current = true; send(initialQuery); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(text?: string, confirm?: boolean) {
    const message = text ?? input.trim();
    if (!message && confirm === undefined) return;
    setErr(''); setBusy(true);
    if (message) setMsgs((m) => [...m, { id: `tmp${Date.now()}`, role: 'user', text: message, tools: [] }]);
    setInput('');
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threadId: thread, message: message || undefined, confirm }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setThread(d.threadId); setMsgs(d.messages);
      if (!thread) window.history.replaceState(null, '', `/console/ai?t=${d.threadId}`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const pending = msgs[msgs.length - 1]?.pending;

  return (
    <div className="grid h-[calc(100vh-9rem)] gap-4 lg:grid-cols-[240px_1fr]">
      <aside className="card hidden flex-col overflow-hidden lg:flex">
        <button className="btn-primary m-3" onClick={() => { setThread(undefined); window.history.replaceState(null, '', '/console/ai'); }}><I.plus />New chat</button>
        <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3 text-sm">{threads.map((t) => (
          <li key={t.id}><button onClick={() => setThread(t.id)} className={`w-full truncate rounded-lg px-2.5 py-2 text-left ${thread === t.id ? 'bg-raised text-ink' : 'text-dim hover:bg-raised/60'}`}>{t.title}</button></li>
        ))}</ul>
      </aside>
      <section className="card flex min-h-0 flex-col">
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-lg bg-brand/15 text-brand"><I.spark /></span><span className="font-semibold">FinX AI</span><span className={`chip ${connected ? 'bg-good/15 text-good' : 'bg-warn/15 text-warn'}`}>{connected ? '● Online' : 'Limited — no API key'}</span></div>
          <span className="hidden text-xs text-mute sm:block">Every change asks you first and is logged.</span>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5" aria-live="polite">
          {msgs.length === 0 && !busy && (
            <div className="mx-auto max-w-2xl py-8 text-center">
              <h2 className="font-display text-2xl font-semibold">Hi {name}. Type it — <span className="grad">the OS does it.</span></h2>
              <p className="mt-2 text-sm text-dim">Ask about any loan or the books, add borrowers and loans, fix invoices, or send reminders. In English, Tamil or Hindi.</p>
              <div className="mt-6 grid gap-2 text-left sm:grid-cols-2">{SUGGEST.map(([k, s]) => (
                <button key={s} onClick={() => send(s)} className="rounded-xl border border-line bg-raised/60 p-3 text-sm hover:border-brand/50"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-brand">{k}</span>{s}</button>
              ))}</div>
            </div>
          )}
          {msgs.map((m) => m.role === 'user' ? (
            <div key={m.id} className="flex justify-end"><div className="max-w-[80%] rounded-2xl rounded-br-md bg-brand px-4 py-2.5 text-sm text-white">{m.text}</div></div>
          ) : (
            <div key={m.id} className="max-w-[88%]">
              {m.tools.length > 0 && <div className="mb-1.5 flex flex-wrap gap-1">{m.tools.map((t, i) => <span key={i} className="chip bg-raised text-mute">{t.replace(/_/g, ' ')}</span>)}</div>}
              {m.text && <div className="rounded-2xl rounded-bl-md border border-line bg-raised/60 px-4 py-2.5"><Md text={m.text} /></div>}
              {m.pending && (
                <div className="mt-2 rounded-2xl border border-brand/40 bg-brand/10 p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-brand">Confirm change</div>
                  <div className="mt-1 text-sm"><Md text={m.pending.summary} /></div>
                  {m === msgs[msgs.length - 1] && (
                    <div className="mt-3 flex gap-2"><button className="btn-primary" disabled={busy} onClick={() => send('', true)}>Confirm</button><button className="btn-ghost" disabled={busy} onClick={() => send('', false)}>Cancel</button></div>
                  )}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-sm text-mute"><span className="h-2 w-2 animate-pulse rounded-full bg-brand" />Working on it…</div>}
          {err && <p role="alert" className="text-sm text-bad">{err}</p>}
          <div ref={end} />
        </div>
        <form className="border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <div className="flex gap-2">
            <input value={input} onChange={(e) => setInput(e.target.value)} className="input" placeholder={pending ? 'Confirm above, or type to change the request…' : 'Ask anything, or tell FinX what to do'} aria-label="Message FinX AI" disabled={busy} />
            <button className="btn-primary" disabled={busy || !input.trim()} aria-label="Send"><I.send /></button>
          </div>
          {!connected && <p className="mt-2 text-xs text-mute">Without an API key FinX AI answers a few common questions only. <Link href="/console/settings?tab=channels" className="text-brand">Connect</Link></p>}
        </form>
      </section>
    </div>
  );
}
