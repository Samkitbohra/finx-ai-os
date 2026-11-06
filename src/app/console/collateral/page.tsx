import Link from 'next/link';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireCtx } from '@/lib/auth';
import { PageHeader, Card, Badge, M, Stat, ASSET_LABEL } from '@/components/ui';
import { fmtNo } from '@/server/core';
import { addDays, fmtDate, todayIST } from '@/lib/dates';
import { fmtCompact, toPaise } from '@/lib/money';

export const metadata = { title: 'Collateral & vault' };

export default async function Collateral() {
  const ctx = await requireCtx();
  const T = schema;
  const rows = await db.select({ c: T.collaterals, loanNo: T.loans.loanNo, loanId: T.loans.id, status: T.loans.status, maturity: T.loans.maturityDate, out: T.loans.outstandingPrincipal, dpd: T.loans.dpd, name: T.borrowers.name, branch: T.branches.name })
    .from(T.collaterals).innerJoin(T.loans, eq(T.loans.id, T.collaterals.loanId)).innerJoin(T.borrowers, eq(T.borrowers.id, T.collaterals.borrowerId)).innerJoin(T.branches, eq(T.branches.id, T.loans.branchId))
    .where(and(eq(T.loans.orgId, ctx.orgId), eq(T.collaterals.status, 'PLEDGED'), ctx.branchId ? eq(T.loans.branchId, ctx.branchId) : undefined, sql`${T.loans.status} in ('ACTIVE','APPROVED','PENDING_APPROVAL')`))
    .orderBy(asc(T.loans.maturityDate));
  const today = todayIST();
  const goldG = rows.filter((r) => r.c.assetType === 'GOLD').reduce((a, r) => a + Number((r.c.details as { netWeight?: number }).netWeight ?? 0), 0);
  const value = rows.reduce((a, r) => a + toPaise(r.c.value), 0);
  const insurance = rows.filter((r) => r.c.assetType === 'VEHICLE' && (r.c.details as { insuranceExpiry?: string }).insuranceExpiry && (r.c.details as { insuranceExpiry: string }).insuranceExpiry <= addDays(today, 30));
  const dueBack = rows.filter((r) => r.maturity && r.maturity >= today && r.maturity <= addDays(today, 7));
  return (
    <>
      <PageHeader title="Collateral & vault" sub="Everything pledged against a live loan, with packet numbers, valuations and what needs action." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Items held" value={rows.length} /><Stat label="Gold in vault" value={`${goldG.toFixed(1)} g`} /><Stat label="Collateral value" value={fmtCompact(value / 100)} />
        <Stat label="Insurance expiring (30 days)" value={insurance.length} tone={insurance.length ? 'warn' : 'good'} hint={`${dueBack.length} items due back this week`} />
      </div>
      <Card pad={false}><div className="overflow-x-auto"><table className="w-full min-w-[980px]">
        <thead><tr><th className="th">Item</th><th className="th">Type</th><th className="th">Borrower · loan</th><th className="th">Branch</th><th className="th">Packet / ID</th><th className="th text-right">Value</th><th className="th text-right">Loan outstanding</th><th className="th">Maturity</th><th className="th">Flag</th></tr></thead>
        <tbody>{rows.map((r) => { const d = r.c.details as Record<string, string | number>; const ins = r.c.assetType === 'VEHICLE' && d.insuranceExpiry && String(d.insuranceExpiry) <= addDays(today, 30); return (
          <tr key={r.c.id} className="tr">
            <td className="td font-medium">{r.c.description}<div className="text-xs text-mute">{r.c.assetType === 'GOLD' ? `${d.netWeight} g · ${d.purityKarat}K` : r.c.assetType === 'VEHICLE' ? `${d.regNo}` : r.c.assetType === 'MACHINERY' ? `S/N ${d.serialNo}` : d.surveyNo ? `Survey ${d.surveyNo}` : ''}</div></td>
            <td className="td text-dim">{ASSET_LABEL[r.c.assetType]}</td>
            <td className="td"><Link href={`/console/loans/${r.loanId}`} className="hover:text-brand">{r.name}</Link><div className="text-xs text-mute">Loan {fmtNo.loan(r.loanNo)}</div></td>
            <td className="td text-dim">{r.branch}</td><td className="td text-xs">{r.c.packetNo ?? '—'}</td>
            <td className="td text-right"><M v={r.c.value} /></td><td className="td text-right"><M v={r.out} /></td><td className="td num text-dim">{fmtDate(r.maturity)}</td>
            <td className="td">{ins ? <Badge v="BLOCKED" label="Insurance expiring" /> : r.dpd > 60 && r.c.assetType === 'GOLD' ? <Badge v="FAILED" label="Auction review" /> : r.maturity && r.maturity <= addDays(today, 7) && r.maturity >= today ? <Badge v="SENT" label="Due back" /> : null}</td>
          </tr>); })}</tbody>
      </table></div></Card>
    </>
  );
}
