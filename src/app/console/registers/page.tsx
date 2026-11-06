import Link from 'next/link';
import { requireCtx } from '@/lib/auth';
import { pledgeRegister } from '@/server/compliance';
import { listLoans } from '@/server/reports';
import { PageHeader, Card, Tabs, M, Badge } from '@/components/ui';
import { fmtNo } from '@/server/core';
import { addMonths, fmtDate, todayIST } from '@/lib/dates';

export const metadata = { title: 'Registers' };

export default async function Registers({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const tab = sp.tab ?? 'pledge';
  const to = sp.to ?? todayIST();
  const from = sp.from ?? addMonths(to, -6);
  return (
    <>
      <PageHeader title="Registers" sub="Statutory registers kept automatically from the loan book. Print or export them for inspection."
        actions={<><a className="btn-ghost" href={`/api/export/pledge-register?from=${from}&to=${to}`}>Export pledge register</a><button className="btn-ghost no-print" form="print">Print</button></>} />
      <Tabs active={tab} items={[{ key: 'pledge', label: 'Pledge register (gold)', href: '?tab=pledge' }, { key: 'loans', label: 'Loan register', href: '?tab=loans' }]} />
      <form className="no-print mb-4 flex items-end gap-2"><input type="hidden" name="tab" value={tab} />
        <div><label className="label" htmlFor="from">From</label><input id="from" type="date" name="from" defaultValue={from} className="input" /></div>
        <div><label className="label" htmlFor="to">To</label><input id="to" type="date" name="to" defaultValue={to} className="input" /></div><button className="btn-ghost">Show</button></form>
      {tab === 'pledge' && (async () => {
        const r = await pledgeRegister(ctx, from, to);
        return (
          <Card title={`Register of pledges · ${fmtDate(from)} – ${fmtDate(to)}`} pad={false}>
            <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-sm">
              <thead><tr>{['S.No', 'Date of pledge', 'Loan', 'Name and address of pledgor', 'Description of articles', 'Net wt (g)', 'Purity', 'Value', 'Amount lent', 'Rate', 'Packet', 'Redeemed / status'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>{r.map((x, i) => { const d = x.details as Record<string, number>; return (
                <tr key={i} className="tr align-top">
                  <td className="td num text-mute">{i + 1}</td><td className="td num">{fmtDate(x.date)}</td><td className="td num">{fmtNo.loan(x.loanNo)}</td>
                  <td className="td"><div className="font-medium">{x.name}</div><div className="text-xs text-mute">{x.father ? `S/o, D/o, W/o ${x.father} · ` : ''}{x.address}</div></td>
                  <td className="td">{x.description}</td><td className="td num">{d.netWeight ?? '—'}</td><td className="td num">{d.purityKarat ? `${d.purityKarat}K` : '—'}</td>
                  <td className="td text-right"><M v={x.value} /></td><td className="td text-right"><M v={x.amount} /></td><td className="td num">{Number(x.rate)}%</td><td className="td text-xs">{x.packet ?? '—'}</td>
                  <td className="td">{x.closedAt ? <span className="text-xs">{fmtDate(x.closedAt)}</span> : null} <Badge v={x.colStatus} /></td>
                </tr>); })}</tbody>
            </table></div>
          </Card>
        );
      })()}
      {tab === 'loans' && (async () => {
        const r = (await listLoans(ctx, { limit: 5000 })).filter((l) => l.startDate && l.startDate >= from && l.startDate <= to).sort((a, b) => (a.startDate! < b.startDate! ? -1 : 1));
        return (
          <Card title={`Register of loans · ${fmtDate(from)} – ${fmtDate(to)}`} pad={false}>
            <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-sm">
              <thead><tr>{['Loan', 'Date', 'Borrower', 'Product', 'Amount', 'Rate', 'Maturity', 'Outstanding', 'Status'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>{r.map((l) => <tr key={l.id} className="tr"><td className="td"><Link className="text-brand" href={`/console/loans/${l.id}`}>{fmtNo.loan(l.loanNo)}</Link></td><td className="td num">{fmtDate(l.startDate)}</td><td className="td">{l.borrowerName}</td><td className="td text-dim">{l.product}</td><td className="td text-right"><M v={l.principal} /></td><td className="td num">{Number(l.rate)}% {l.method.toLowerCase()}</td><td className="td num">{fmtDate(l.maturityDate)}</td><td className="td text-right"><M v={l.outstanding} /></td><td className="td"><Badge v={l.status} /></td></tr>)}</tbody>
            </table></div>
          </Card>
        );
      })()}
      <form id="print" action="javascript:window.print()" />
    </>
  );
}
