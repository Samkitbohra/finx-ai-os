import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getBorrowerId } from '@/lib/auth';
import { borrowerHome } from '@/server/borrower-app';
import { fmtP } from '@/lib/money';
import { t } from '../../../i18n';
import { PayForm } from './form';

export default async function Pay({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await borrowerHome((await getBorrowerId())!);
  const l = d?.loans.find((x) => x.id === id);
  if (!d || !l || l.status !== 'ACTIVE') notFound();
  const s = t(d.borrower.language);
  const suggested = l.dues?.dueNow || l.dues?.nextDue?.amount || 10000;
  return (
    <main>
      <Link href="/app" className="text-sm text-mute">← {s.back}</Link>
      <h1 className="mt-3 font-display text-2xl font-semibold">{s.payNow}</h1>
      <p className="text-sm text-dim">{l.product} · {l.loanNo} · {s.outstanding} {fmtP(l.outstanding)}</p>
      <PayForm loanId={id} vpa={d.org?.upiVpa ?? ''} payee={d.org?.name ?? ''} loanNo={l.loanNo} suggested={suggested / 100} save100={l.save100 / 100} strings={{ anyAmount: s.anyAmount, utr: s.utr, report: s.report, thanks: s.thanks, payNow: s.payNow }} />
    </main>
  );
}
