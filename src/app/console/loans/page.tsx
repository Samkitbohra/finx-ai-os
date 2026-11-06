import Link from 'next/link';
import { requireCtx } from '@/lib/auth';
import { listLoans } from '@/server/reports';
import { PageHeader, Card, Badge, Dpd, M, Avatar, Empty, Tabs, ASSET_LABEL } from '@/components/ui';
import { fmtNo } from '@/server/core';
import { fmtDate } from '@/lib/dates';

export const metadata = { title: 'Loans' };

export default async function LoansPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const status = sp.status ?? (sp.q ? undefined : 'ACTIVE');
  const rows = await listLoans(ctx, { status: status === 'all' ? undefined : status, q: sp.q, dpdMin: sp.overdue ? 1 : undefined, assetType: sp.asset });
  const qs = (o: Record<string, string | undefined>) => '?' + new URLSearchParams(Object.entries({ ...sp, ...o }).filter(([, v]) => v) as [string, string][]).toString();
  const total = rows.reduce((a, r) => a + Number(r.outstanding), 0);

  return (
    <>
      <PageHeader title="Loans" sub={sp.q ? `Results for “${sp.q}”` : `${rows.length} loans · ₹${Math.round(total).toLocaleString('en-IN')} outstanding`}
        actions={<><a href={`/api/export/loans${qs({})}`} className="btn-ghost">Export CSV</a><Link href="/console/loans/new" className="btn-primary">New loan</Link></>} />
      <Tabs active={sp.overdue ? 'overdue' : status ?? 'all'} items={[
        { key: 'ACTIVE', label: 'Active', href: qs({ status: 'ACTIVE', overdue: undefined }) },
        { key: 'overdue', label: 'Overdue', href: qs({ status: 'ACTIVE', overdue: '1' }) },
        { key: 'PENDING_APPROVAL', label: 'Awaiting approval', href: qs({ status: 'PENDING_APPROVAL', overdue: undefined }) },
        { key: 'APPROVED', label: 'To disburse', href: qs({ status: 'APPROVED', overdue: undefined }) },
        { key: 'CLOSED', label: 'Closed', href: qs({ status: 'CLOSED', overdue: undefined }) },
        { key: 'all', label: 'All', href: qs({ status: 'all', overdue: undefined }) },
      ]} />
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {['', 'GOLD', 'VEHICLE', 'PROPERTY', 'MACHINERY', 'BUSINESS', 'UNSECURED'].map((a) => (
          <Link key={a} href={qs({ asset: a || undefined })} className={`chip ${(sp.asset ?? '') === a ? 'bg-brand/20 text-brand' : 'bg-raised text-dim'}`}>{a ? ASSET_LABEL[a] : 'All products'}</Link>
        ))}
      </div>
      <Card pad={false}>
        {rows.length === 0 ? <div className="p-6"><Empty title="No loans here" sub="Try another filter, or create a loan." action={<Link href="/console/loans/new" className="btn-primary">New loan</Link>} /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px]">
              <thead><tr><th className="th">Borrower</th><th className="th">Product</th><th className="th">Branch</th><th className="th">Rate</th><th className="th">LTV</th><th className="th">Maturity</th><th className="th text-right">Amount</th><th className="th text-right">Outstanding</th><th className="th">Status</th></tr></thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id} className="tr">
                    <td className="td"><Link href={`/console/loans/${l.id}`} className="flex items-center gap-3"><Avatar name={l.borrowerName} /><span><span className="block font-medium hover:text-brand">{l.borrowerName}</span><span className="text-xs text-mute">Loan {fmtNo.loan(l.loanNo)} · {l.phone}</span></span></Link></td>
                    <td className="td text-dim">{l.product}</td>
                    <td className="td text-dim">{l.branch}</td>
                    <td className="td num text-dim">{Number(l.rate)}%</td>
                    <td className="td num text-dim">{l.ltv ? `${Number(l.ltv).toFixed(0)}%` : '—'}</td>
                    <td className="td num text-dim">{fmtDate(l.maturityDate)}</td>
                    <td className="td text-right"><M v={l.principal} /></td>
                    <td className="td text-right font-medium"><M v={l.outstanding} /></td>
                    <td className="td">{l.status === 'ACTIVE' ? <Dpd d={l.dpd} /> : <Badge v={l.status} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
