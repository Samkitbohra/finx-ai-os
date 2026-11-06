import Link from 'next/link';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireCtx } from '@/lib/auth';
import { portfolio, listLoans } from '@/server/reports';
import { refreshPortfolio } from '@/server/loans';
import { fmtCompact, fmtP } from '@/lib/money';
import { Card, PageHeader, Stat, BarPair, Dpd, Badge, M, Avatar, ASSET_LABEL } from '@/components/ui';
import { fmtNo } from '@/server/core';

export const metadata = { title: 'Portfolio' };
const MONTH = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export default async function Dashboard() {
  const ctx = await requireCtx();
  await refreshPortfolio(ctx.orgId);
  const [p, watch, activity] = await Promise.all([
    portfolio(ctx),
    listLoans(ctx, { status: 'ACTIVE', limit: 8 }),
    db.select().from(schema.auditLogs).where(eq(schema.auditLogs.orgId, ctx.orgId)).orderBy(desc(schema.auditLogs.at)).limit(8),
  ]);
  const growth = p.collectedLastMonth ? ((p.collectedMtd - p.collectedLastMonth) / p.collectedLastMonth) * 100 : 0;
  const total = Object.values(p.buckets).reduce((a, b) => a + b, 0) || 1;
  const buckets: [string, keyof typeof p.buckets, string][] = [['Current', 'current', 'bg-good'], ['1–30 days', 'd1_30', 'bg-warn'], ['31–60 days', 'd31_60', 'bg-warn'], ['61–90 days', 'd61_90', 'bg-bad/70'], ['90+ (NPA)', 'd90p', 'bg-bad']];
  void and;

  return (
    <>
      <PageHeader title="Portfolio" sub={ctx.branchId ? 'Your branch' : 'All branches'}
        actions={<><Link href="/console/loans/new" className="btn-primary">New loan</Link><Link href="/console/collections" className="btn-ghost">Collections queue</Link></>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Book value" value={fmtCompact(p.aum / 100)} hint={`${p.loans} live loans`} />
        <Stat label="Yield" value={`${p.yieldPct.toFixed(1)}%`} hint="Weighted by outstanding" />
        <Stat label="NPA 90+" value={`${p.npaPct.toFixed(1)}%`} tone={p.npaPct > 5 ? 'bad' : undefined} hint={fmtCompact(p.npa / 100)} />
        <Stat label="Collected MTD" value={fmtCompact(p.collectedMtd / 100)} delta={p.collectedLastMonth ? { text: `${Math.abs(growth).toFixed(0)}% vs last month`, good: growth >= 0 } : null} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card title="Disbursed against collected" actions={<span className="chip bg-good/15 text-good">● Live</span>}>
          <BarPair labels={['Disbursed', 'Collected']} data={p.series.map((s) => ({ label: MONTH[Number(s.month.slice(5)) - 1], a: s.disbursed, b: s.collected }))} />
        </Card>
        <Card title="Ageing">
          <div className="mb-4 flex h-3 overflow-hidden rounded-full bg-raised">
            {buckets.map(([, k, c]) => <div key={k} className={c} style={{ width: `${(p.buckets[k] / total) * 100}%` }} />)}
          </div>
          <ul className="space-y-2.5 text-sm">
            {buckets.map(([l, k, c]) => (
              <li key={k} className="flex items-center gap-3">
                <i className={`h-2.5 w-2.5 rounded-sm ${c}`} /><span className="flex-1 text-dim">{l}</span>
                <span className="num text-mute">{p.counts[k]} loans</span><span className="num w-24 text-right">{fmtCompact(p.buckets[k] / 100)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-5 grid grid-cols-3 gap-2 border-t border-line pt-4 text-center">
            <Link href="/console/approvals" className="rounded-lg p-2 hover:bg-raised"><div className="num text-xl font-semibold">{p.pendingApprovals}</div><div className="text-xs text-mute">to approve</div></Link>
            <Link href="/console/approvals" className="rounded-lg p-2 hover:bg-raised"><div className="num text-xl font-semibold">{p.awaitingDisbursal}</div><div className="text-xs text-mute">to disburse</div></Link>
            <Link href="/console/collateral" className="rounded-lg p-2 hover:bg-raised"><div className="num text-xl font-semibold">{p.dueBack}</div><div className="text-xs text-mute">collateral due back in 7 days</div></Link>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card title="Needs attention" actions={<Link href="/console/loans?status=ACTIVE" className="text-xs text-brand">All loans →</Link>} pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px]">
              <thead><tr><th className="th">Borrower</th><th className="th">Product</th><th className="th">LTV</th><th className="th text-right">Outstanding</th><th className="th">Status</th></tr></thead>
              <tbody>
                {watch.map((l) => (
                  <tr key={l.id} className="tr">
                    <td className="td"><Link href={`/console/loans/${l.id}`} className="flex items-center gap-3"><Avatar name={l.borrowerName} /><span><span className="block font-medium">{l.borrowerName}</span><span className="text-xs text-mute">Loan {fmtNo.loan(l.loanNo)}</span></span></Link></td>
                    <td className="td text-dim">{l.product}<div className="text-xs text-mute">{ASSET_LABEL[l.assetType]}</div></td>
                    <td className="td num text-dim">{l.ltv ? `${Number(l.ltv).toFixed(0)}%` : '—'}</td>
                    <td className="td text-right"><M v={l.outstanding} /></td>
                    <td className="td"><Dpd d={l.dpd} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Activity" actions={<Link href="/console/compliance?tab=audit" className="text-xs text-brand">Audit trail →</Link>}>
          <ol className="space-y-3">
            {activity.map((a) => (
              <li key={a.id} className="text-sm">
                <div className="text-ink">{a.summary ?? `${a.action} ${a.entity}`}</div>
                <div className="mt-0.5 flex gap-2 text-xs text-mute"><span>{a.at.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</span><Badge v={a.via} label={a.via === 'CHAT' ? 'via FinX AI' : a.via === 'AGENT' ? 'via agent' : a.via.toLowerCase()} /></div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
      <p className="mt-6 text-xs text-mute">Disbursed this month: {fmtP(p.disbursedMtd)}</p>
    </>
  );
}
