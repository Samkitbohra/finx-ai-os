import Link from 'next/link';
import { requireCtx } from '@/lib/auth';
import { listLoans } from '@/server/reports';
import { PageHeader, Card, M, Avatar, Empty } from '@/components/ui';
import { fmtNo } from '@/server/core';

export const metadata = { title: 'Approvals' };

export default async function Approvals() {
  const ctx = await requireCtx();
  const [pending, approved] = await Promise.all([listLoans(ctx, { status: 'PENDING_APPROVAL' }), listLoans(ctx, { status: 'APPROVED' })]);
  const Section = ({ title, rows, cta }: { title: string; rows: Awaited<ReturnType<typeof listLoans>>; cta: string }) => (
    <Card title={`${title} (${rows.length})`} pad={false}>
      {rows.length === 0 ? <div className="p-5"><Empty title="Nothing waiting" /></div> : (
        <table className="w-full"><tbody>{rows.map((l) => (
          <tr key={l.id} className="tr">
            <td className="td"><div className="flex items-center gap-3"><Avatar name={l.borrowerName} /><div><div className="font-medium">{l.borrowerName}</div><div className="text-xs text-mute">Loan {fmtNo.loan(l.loanNo)} · {l.product} · {l.branch}</div></div></div></td>
            <td className="td text-dim">{l.ltv ? `LTV ${Number(l.ltv).toFixed(1)}%` : 'Unsecured'} · {Number(l.rate)}%</td>
            <td className="td text-right font-medium"><M v={l.principal} /></td>
            <td className="td text-right"><Link href={`/console/loans/${l.id}`} className="btn-primary">{cta}</Link></td>
          </tr>
        ))}</tbody></table>
      )}
    </Card>
  );
  return (
    <>
      <PageHeader title="Approvals" sub="Maker-checker: loans are approved by someone other than the officer who created them." />
      <div className="space-y-4"><Section title="Awaiting approval" rows={pending} cta="Review" /><Section title="Approved, to disburse" rows={approved} cta="Disburse" /></div>
    </>
  );
}
