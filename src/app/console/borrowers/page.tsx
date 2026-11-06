import Link from 'next/link';
import { requireCtx } from '@/lib/auth';
import { listBorrowers } from '@/server/reports';
import { PageHeader, Card, Badge, M, Avatar, Empty } from '@/components/ui';
import { fmtNo } from '@/server/core';

export const metadata = { title: 'Borrowers' };

export default async function Borrowers({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const ctx = await requireCtx();
  const rows = await listBorrowers(ctx, { q });
  return (
    <>
      <PageHeader title="Borrowers" sub={`${rows.length} borrowers`} actions={<Link href="/console/borrowers/new" className="btn-primary">New borrower</Link>} />
      <form className="mb-4 max-w-md"><input name="q" defaultValue={q} className="input" placeholder="Search name, phone or PAN" aria-label="Search borrowers" /></form>
      <Card pad={false}>
        {rows.length === 0 ? <div className="p-6"><Empty title="No borrowers found" /></div> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[760px]">
            <thead><tr><th className="th">Borrower</th><th className="th">Phone</th><th className="th">Area</th><th className="th">Language</th><th className="th">KYC</th><th className="th">Score</th><th className="th text-right">Live loans</th><th className="th text-right">Outstanding</th></tr></thead>
            <tbody>{rows.map((b) => (
              <tr key={b.id} className="tr">
                <td className="td"><Link href={`/console/borrowers/${b.id}`} className="flex items-center gap-3"><Avatar name={b.name} /><span><span className="block font-medium hover:text-brand">{b.name}</span><span className="text-xs text-mute">{fmtNo.borrower(b.code)}</span></span></Link></td>
                <td className="td num text-dim">{b.phone}</td>
                <td className="td text-dim">{b.city ?? '—'}</td>
                <td className="td text-dim uppercase">{b.language}</td>
                <td className="td"><Badge v={b.kyc} /></td>
                <td className="td num">{b.score}</td>
                <td className="td num text-right">{b.loans}</td>
                <td className="td text-right"><M v={b.outstanding} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
