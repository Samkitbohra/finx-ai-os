import Link from 'next/link';
import { getBorrowerId } from '@/lib/auth';
import { borrowerHome } from '@/server/borrower-app';
import { fmtP } from '@/lib/money';
import { fmtDate } from '@/lib/dates';
import { t } from '../i18n';
import { signOutAction } from '../actions';

export default async function Home() {
  const d = await borrowerHome((await getBorrowerId())!);
  if (!d) return null;
  const s = t(d.borrower.language);
  const score = d.borrower.repaymentScore;
  return (
    <main>
      <header className="mb-6 flex items-center justify-between">
        <div><div className="text-xs text-mute">{d.org?.name}</div><h1 className="font-display text-2xl font-semibold">{s.hello}, {d.borrower.name.split(' ')[0]}</h1></div>
        <form action={signOutAction}><button className="text-xs text-mute">{s.signOut}</button></form>
      </header>
      <section className="card mb-5 flex items-center gap-4 p-4">
        <div className="relative grid h-16 w-16 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(rgb(var(--good)) ${((score - 300) / 600) * 360}deg, rgb(var(--raised)) 0)` }}>
          <div className="grid h-12 w-12 place-items-center rounded-full bg-panel font-display text-lg font-semibold">{score}</div>
        </div>
        <div><div className="font-semibold">{s.score}</div><p className="text-xs text-dim">{s.scoreHint}</p></div>
      </section>
      <h2 className="mb-3 text-sm font-semibold text-dim">{s.yourLoans}</h2>
      <div className="space-y-4">{d.loans.map((l) => (
        <article key={l.id} className="card overflow-hidden">
          <Link href={`/app/loan/${l.id}`} className="block p-5">
            <div className="flex items-center justify-between text-xs text-mute"><span>{l.product} · {l.loanNo}</span>{l.status !== 'ACTIVE' && <span className="chip bg-good/15 text-good">{l.status === 'CLOSED' ? s.closed : l.status.toLowerCase()}</span>}</div>
            <div className="mt-3 text-xs uppercase tracking-wider text-mute">{s.outstanding}</div>
            <div className="num font-display text-4xl font-semibold">{fmtP(l.outstanding)}</div>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
              <div><dt className="text-xs text-mute">{s.lent}</dt><dd className="num">{fmtP(l.lent)}</dd></div>
              <div><dt className="text-xs text-mute">{s.paid}</dt><dd className="num">{fmtP(l.paid)}</dd></div>
              <div><dt className="text-xs text-mute">{s.rate}</dt><dd className="num">{l.rate}% {s.perYear}</dd></div>
            </dl>
            {l.dues && <div className={`mt-4 rounded-xl p-3 text-sm ${l.dues.dueNow ? 'bg-warn/10 text-warn' : 'bg-good/10 text-good'}`}>{l.dues.dueNow ? `${s.due}: ${fmtP(l.dues.dueNow)}` : l.dues.nextDue ? `${s.next}: ${fmtP(l.dues.nextDue.amount)} · ${fmtDate(l.dues.nextDue.date)}` : s.nothingDue}</div>}
          </Link>
          {l.status === 'ACTIVE' && <Link href={`/app/pay/${l.id}`} className="block border-t border-line bg-brand px-5 py-3.5 text-center font-medium text-white">{l.save100 > 0 ? s.save('₹100', fmtP(l.save100)) : s.payNow}</Link>}
        </article>
      ))}</div>
      {d.receipts.length > 0 && <>
        <h2 className="mb-3 mt-8 text-sm font-semibold text-dim">{s.receipts}</h2>
        <ul className="card divide-y divide-line">{d.receipts.map(({ p, loanNo }) => (
          <li key={p.id} className="flex items-center justify-between px-4 py-3 text-sm"><span><span className="num">R-{String(p.receiptNo).padStart(5, '0')}</span><span className="block text-xs text-mute">{p.receivedAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })} · {String(loanNo).padStart(4, '0')} · {p.mode}</span></span><span className="num font-medium">{fmtP(Number(p.amount) * 100)}</span></li>
        ))}</ul>
      </>}
    </main>
  );
}
