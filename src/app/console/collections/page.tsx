import Link from 'next/link';
import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireCtx } from '@/lib/auth';
import { listLoans } from '@/server/reports';
import { channelStatus } from '@/server/channels';
import { PageHeader, Card, Badge, Dpd, M, Avatar, Stat, Tabs } from '@/components/ui';
import { ActionForm } from '@/components/form';
import { fmtNo } from '@/server/core';
import { fmtDate, todayIST } from '@/lib/dates';
import { runCollectionsAction } from '../actions';

export const metadata = { title: 'Collections' };

export default async function Collections({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = 'queue' } = await searchParams;
  const ctx = await requireCtx();
  const T = schema;
  const [overdue, org, ptps, log, stats] = await Promise.all([
    listLoans(ctx, { status: 'ACTIVE', dpdMin: 1, limit: 300 }),
    db.query.organizations.findFirst({ where: eq(T.organizations.id, ctx.orgId) }),
    db.select({ id: T.communications.id, date: T.communications.ptpDate, amount: T.communications.ptpAmount, loanId: T.communications.loanId, name: T.borrowers.name, channel: T.communications.channel })
      .from(T.communications).innerJoin(T.borrowers, eq(T.borrowers.id, T.communications.borrowerId))
      .where(and(eq(T.communications.orgId, ctx.orgId), isNotNull(T.communications.ptpDate), gte(T.communications.ptpDate, todayIST()))).orderBy(T.communications.ptpDate).limit(50),
    db.select({ c: T.communications, name: T.borrowers.name }).from(T.communications).innerJoin(T.borrowers, eq(T.borrowers.id, T.communications.borrowerId))
      .where(eq(T.communications.orgId, ctx.orgId)).orderBy(desc(T.communications.createdAt)).limit(100),
    db.select({
      sent: sql<number>`count(*) filter (where ${T.communications.status} in ('SENT','DELIVERED','READ','COMPLETED') and ${T.communications.direction}='OUT')::int`,
      blocked: sql<number>`count(*) filter (where ${T.communications.status} = 'BLOCKED')::int`,
      ptp: sql<number>`count(*) filter (where ${T.communications.outcome} = 'PROMISE_TO_PAY')::int`,
    }).from(T.communications).where(and(eq(T.communications.orgId, ctx.orgId), gte(T.communications.createdAt, new Date(Date.now() - 30 * 86400_000)))),
  ]);
  const live = channelStatus();
  const total = overdue.reduce((a, l) => a + Number(l.outstanding), 0);

  return (
    <>
      <PageHeader title="Collections" sub={`One agent on voice, WhatsApp, SMS and email · contact hours ${org?.callWindowStart}:00–${org?.callWindowEnd}:00 IST · max ${org?.maxContactsPerDay} contacts a day per borrower`}
        actions={<>
          <ActionForm action={runCollectionsAction} submit="Preview today’s run" submitClass="btn-ghost"><input type="hidden" name="dry" value="1" /></ActionForm>
          <ActionForm action={runCollectionsAction} submit="Run the agent now" confirm="Contact every due and overdue borrower now, inside the contact rules?" />
        </>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Overdue loans" value={overdue.length} tone={overdue.length ? 'warn' : 'good'} hint={`₹${Math.round(total).toLocaleString('en-IN')} outstanding`} />
        <Stat label="Contacts (30 days)" value={stats[0].sent} hint="Delivered or completed" />
        <Stat label="Held back by rules" value={stats[0].blocked} hint="Hours, consent or daily limit" />
        <Stat label="Promises to pay" value={stats[0].ptp} hint="Last 30 days" />
      </div>
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {(['VOICE', 'WHATSAPP', 'SMS', 'EMAIL'] as const).map((c) => <span key={c} className={`chip ${live[c] ? 'bg-good/15 text-good' : 'bg-raised text-mute'}`}>{c.toLowerCase()} · {live[c] ? 'live' : 'simulation'}</span>)}
        <Link href="/console/settings?tab=channels" className="text-brand">Connect channels →</Link>
      </div>
      <Tabs active={tab} items={[{ key: 'queue', label: `Overdue queue (${overdue.length})`, href: '?tab=queue' }, { key: 'ptp', label: `Promises (${ptps.length})`, href: '?tab=ptp' }, { key: 'log', label: 'Contact log', href: '?tab=log' }]} />

      {tab === 'queue' && (
        <Card pad={false}><div className="overflow-x-auto"><table className="w-full min-w-[760px]">
          <thead><tr><th className="th">Borrower</th><th className="th">Product</th><th className="th">Phone</th><th className="th text-right">Outstanding</th><th className="th">Late by</th><th className="th">Next step</th></tr></thead>
          <tbody>{overdue.map((l) => (
            <tr key={l.id} className="tr">
              <td className="td"><Link href={`/console/loans/${l.id}`} className="flex items-center gap-3"><Avatar name={l.borrowerName} /><span><span className="block font-medium hover:text-brand">{l.borrowerName}</span><span className="text-xs text-mute">Loan {fmtNo.loan(l.loanNo)}</span></span></Link></td>
              <td className="td text-dim">{l.product}</td>
              <td className="td num text-dim">{l.phone}</td>
              <td className="td text-right"><M v={l.outstanding} /></td>
              <td className="td"><Dpd d={l.dpd} /></td>
              <td className="td text-sm text-dim">{l.dpd <= 15 ? 'WhatsApp + AI call' : l.assetType === 'GOLD' && l.dpd >= 60 ? 'AI call + auction notice' : 'AI call, then field visit'}</td>
            </tr>
          ))}</tbody>
        </table></div></Card>
      )}
      {tab === 'ptp' && (
        <Card pad={false}>{ptps.length === 0 ? <p className="p-5 text-sm text-dim">No open promises.</p> : <table className="w-full"><tbody>{ptps.map((p) => (
          <tr key={p.id} className="tr"><td className="td font-medium">{p.name}</td><td className="td num">{fmtDate(p.date)}</td><td className="td text-right">{p.amount ? <M v={p.amount} /> : '—'}</td><td className="td text-dim">{p.channel.toLowerCase()}</td><td className="td text-right">{p.loanId && <Link className="text-brand" href={`/console/loans/${p.loanId}`}>Open loan →</Link>}</td></tr>
        ))}</tbody></table>}</Card>
      )}
      {tab === 'log' && (
        <Card pad={false}><div className="overflow-x-auto"><table className="w-full min-w-[860px]">
          <thead><tr><th className="th">When</th><th className="th">Borrower</th><th className="th">Channel</th><th className="th">Status</th><th className="th">Message</th></tr></thead>
          <tbody>{log.map(({ c, name }) => (
            <tr key={c.id} className="tr align-top">
              <td className="td num whitespace-nowrap text-xs text-mute">{c.createdAt.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</td>
              <td className="td">{c.loanId ? <Link className="hover:text-brand" href={`/console/loans/${c.loanId}`}>{name}</Link> : name}</td>
              <td className="td text-dim">{c.direction === 'IN' ? '↙ ' : ''}{c.channel.toLowerCase()} · {c.language}</td>
              <td className="td"><Badge v={c.status} />{c.blockReason && <div className="mt-1 text-xs text-warn">{c.blockReason}</div>}</td>
              <td className="td max-w-md text-sm text-dim">{c.content.slice(0, 160)}{c.content.length > 160 ? '…' : ''}</td>
            </tr>
          ))}</tbody>
        </table></div></Card>
      )}
    </>
  );
}
