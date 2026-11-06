import { and, eq, gte, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireCtx } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { PageHeader, Card, ASSET_LABEL } from '@/components/ui';
import { ActionForm, Field, Select } from '@/components/form';
import { fmtCompact, toPaise } from '@/lib/money';
import { todayIST } from '@/lib/dates';
import { targetAction } from '../actions';

export const metadata = { title: 'Analytics & MIS' };

const Bar = ({ v, max, tone = 'bg-brand' }: { v: number; max: number; tone?: string }) => (
  <div className="h-2 w-full overflow-hidden rounded-full bg-raised"><div className={`h-full ${tone}`} style={{ width: `${max ? Math.min(100, (v / max) * 100) : 0}%` }} /></div>
);

export default async function Analytics() {
  const ctx = await requireCtx();
  const T = schema;
  const month = todayIST().slice(0, 7);
  const monthStart = new Date(`${month}-01T00:00:00+05:30`);
  const scope = ctx.branchId ? eq(T.loans.branchId, ctx.branchId) : undefined;

  const book = (key: typeof T.branches.name | typeof T.products.assetType | typeof T.users.name) => db.select({
    k: key, loans: sql<number>`count(*)::int`, aum: sql<string>`coalesce(sum(${T.loans.outstandingPrincipal}),0)`,
    w: sql<string>`coalesce(sum(${T.loans.outstandingPrincipal} * ${T.loans.annualRate}),0)`,
    npa: sql<string>`coalesce(sum(${T.loans.outstandingPrincipal}) filter (where ${T.loans.dpd} > 90),0)`,
    late: sql<number>`count(*) filter (where ${T.loans.dpd} > 30)::int`,
  });
  const [byBranch, byProduct, byOfficer, coll, disb, targets] = await Promise.all([
    book(T.branches.name).from(T.loans).innerJoin(T.branches, eq(T.branches.id, T.loans.branchId)).where(and(eq(T.loans.orgId, ctx.orgId), eq(T.loans.status, 'ACTIVE'), scope)).groupBy(T.branches.name),
    book(T.products.assetType).from(T.loans).innerJoin(T.products, eq(T.products.id, T.loans.productId)).where(and(eq(T.loans.orgId, ctx.orgId), eq(T.loans.status, 'ACTIVE'), scope)).groupBy(T.products.assetType),
    book(T.users.name).from(T.loans).innerJoin(T.users, eq(T.users.id, T.loans.officerId)).where(and(eq(T.loans.orgId, ctx.orgId), eq(T.loans.status, 'ACTIVE'), scope)).groupBy(T.users.name),
    db.select({ b: T.branches.id, amt: sql<string>`coalesce(sum(${T.payments.amount}),0)` }).from(T.payments).innerJoin(T.loans, eq(T.loans.id, T.payments.loanId)).innerJoin(T.branches, eq(T.branches.id, T.loans.branchId))
      .where(and(eq(T.payments.orgId, ctx.orgId), eq(T.payments.reversed, false), gte(T.payments.receivedAt, monthStart))).groupBy(T.branches.id),
    db.select({ b: T.loans.branchId, amt: sql<string>`coalesce(sum(${T.loans.principal}),0)` }).from(T.disbursements).innerJoin(T.loans, eq(T.loans.id, T.disbursements.loanId))
      .where(and(eq(T.loans.orgId, ctx.orgId), gte(T.disbursements.at, monthStart))).groupBy(T.loans.branchId),
    db.select({ t: T.branchTargets, name: T.branches.name, code: T.branches.code }).from(T.branches).leftJoin(T.branchTargets, and(eq(T.branchTargets.branchId, T.branches.id), eq(T.branchTargets.month, month))).where(eq(T.branches.orgId, ctx.orgId)),
  ]);
  const branches = await db.select().from(T.branches).where(eq(T.branches.orgId, ctx.orgId));
  const Table = ({ rows, label, fmtK }: { rows: typeof byBranch; label: string; fmtK?: (k: string) => string }) => {
    const max = Math.max(...rows.map((r) => toPaise(r.aum)), 1);
    return (
      <table className="w-full"><thead><tr><th className="th">{label}</th><th className="th">Book</th><th className="th text-right">Loans</th><th className="th text-right">Yield</th><th className="th text-right">NPA 90+</th><th className="th text-right">30+ late</th></tr></thead>
        <tbody>{rows.sort((a, b) => toPaise(b.aum) - toPaise(a.aum)).map((r) => { const aum = toPaise(r.aum); return (
          <tr key={String(r.k)} className="tr"><td className="td font-medium">{fmtK ? fmtK(String(r.k)) : r.k}</td><td className="td w-1/3"><div className="flex items-center gap-3"><Bar v={aum} max={max} /><span className="num w-20 text-right text-sm">{fmtCompact(aum / 100)}</span></div></td>
            <td className="td num text-right">{r.loans}</td><td className="td num text-right">{aum ? (toPaise(r.w) / aum).toFixed(1) : '0'}%</td><td className={`td num text-right ${toPaise(r.npa) ? 'text-bad' : ''}`}>{aum ? ((toPaise(r.npa) / aum) * 100).toFixed(1) : '0'}%</td><td className="td num text-right">{r.late}</td></tr>); })}</tbody></table>
    );
  };
  return (
    <>
      <PageHeader title="Analytics & MIS" sub="Yield, NPA and targets by branch, product and officer." />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="By branch" pad={false}><Table rows={byBranch} label="Branch" /></Card>
        <Card title="By product" pad={false}><Table rows={byProduct} label="Product" fmtK={(k) => ASSET_LABEL[k] ?? k} /></Card>
        <Card title="By loan officer" pad={false}><Table rows={byOfficer} label="Officer" /></Card>
        <Card title={`Targets · ${month}`}>
          <ul className="space-y-5">{targets.map(({ t, name, code }) => {
            const b = branches.find((x) => x.code === code)!;
            const c = toPaise(coll.find((x) => x.b === b.id)?.amt ?? 0), d = toPaise(disb.find((x) => x.b === b.id)?.amt ?? 0);
            const ct = toPaise(t?.collectionTarget ?? 0), dt = toPaise(t?.disbursalTarget ?? 0);
            return (
              <li key={code}>
                <div className="mb-2 flex justify-between text-sm"><span className="font-medium">{name}</span><span className="text-xs text-mute">{t ? `Incentive ${Number(t.incentivePct)}% of collections over target` : 'No target set'}</span></div>
                <div className="grid grid-cols-[90px_1fr_150px] items-center gap-3 text-xs text-dim"><span>Disbursed</span><Bar v={d} max={dt || d || 1} /><span className="num text-right">{fmtCompact(d / 100)} / {fmtCompact(dt / 100)}</span>
                  <span>Collected</span><Bar v={c} max={ct || c || 1} tone="bg-good" /><span className="num text-right">{fmtCompact(c / 100)} / {fmtCompact(ct / 100)}</span></div>
              </li>
            );
          })}</ul>
          {can(ctx.role, 'settings.write') && (
            <ActionForm action={targetAction} className="mt-6 grid gap-2 border-t border-line pt-4 sm:grid-cols-5" submit="Set target" submitClass="btn-ghost">
              <Select label="Branch" name="branchId" options={branches.map((b) => [b.id, b.name])} className="sm:col-span-2" />
              <input type="hidden" name="month" value={month} />
              <Field label="Disburse (₹)" name="disbursalTarget" type="number" required />
              <Field label="Collect (₹)" name="collectionTarget" type="number" required />
              <Field label="Incentive %" name="incentivePct" type="number" step="0.1" />
            </ActionForm>
          )}
        </Card>
      </div>
    </>
  );
}
