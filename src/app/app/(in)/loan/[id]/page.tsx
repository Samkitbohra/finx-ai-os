import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getBorrowerId } from '@/lib/auth';
import { borrowerHome } from '@/server/borrower-app';
import { fmtP, toPaise } from '@/lib/money';
import { fmtDate, todayIST } from '@/lib/dates';
import { t } from '../../../i18n';

export default async function LoanView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await borrowerHome((await getBorrowerId())!);
  const l = d?.loans.find((x) => x.id === id);
  if (!d || !l) notFound();
  const s = t(d.borrower.language);
  return (
    <main>
      <Link href="/app" className="text-sm text-mute">← {s.back}</Link>
      <h1 className="mt-3 font-display text-2xl font-semibold">{l.product} · {l.loanNo}</h1>
      <p className="text-sm text-dim">{l.rate}% {s.perYear} · {l.method === 'FLAT' ? 'flat' : l.method === 'DAILY' ? 'daily on balance' : 'on reducing balance'}</p>
      <p className="mt-3 rounded-xl bg-raised p-3 text-sm text-dim">{s.anyAmount}</p>
      <h2 className="mb-2 mt-6 text-sm font-semibold text-dim">{s.schedule}</h2>
      <ul className="card divide-y divide-line">{l.rows.map((r) => {
        const amt = toPaise(r.principalDue) + toPaise(r.interestDue);
        const late = r.status !== 'PAID' && r.dueDate < todayIST();
        return <li key={r.id} className="flex items-center justify-between px-4 py-3 text-sm"><span className={late ? 'text-bad' : ''}>{fmtDate(r.dueDate)}</span><span className="num">{fmtP(amt)}</span><span className={`chip ${r.status === 'PAID' ? 'bg-good/15 text-good' : late ? 'bg-bad/15 text-bad' : 'bg-raised text-mute'}`}>{r.status === 'PAID' ? '✓' : late ? '!' : '·'}</span></li>;
      })}</ul>
      {l.status === 'ACTIVE' && <Link href={`/app/pay/${l.id}`} className="btn-primary mt-6 w-full py-3 text-base">{s.payNow}</Link>}
    </main>
  );
}
