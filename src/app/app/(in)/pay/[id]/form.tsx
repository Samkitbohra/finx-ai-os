'use client';
import { useActionState, useState } from 'react';
import { reportPaymentAction } from '../../../actions';

export function PayForm({ loanId, vpa, payee, loanNo, suggested, save100, strings }: { loanId: string; vpa: string; payee: string; loanNo: string; suggested: number; save100: number; strings: Record<string, string> }) {
  const [amount, setAmount] = useState(Math.round(suggested));
  const [s, act, pending] = useActionState(reportPaymentAction.bind(null, loanId), undefined);
  const upi = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(payee)}&am=${amount}&cu=INR&tn=${encodeURIComponent(`Loan ${loanNo}`)}`;
  if (s?.ok) return <p className="card mt-6 p-5 text-good">{strings.thanks}</p>;
  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap gap-2">{[100, 500, 1000, Math.round(suggested)].filter((v, i, a) => a.indexOf(v) === i).map((v) => (
        <button key={v} type="button" onClick={() => setAmount(v)} className={`chip px-3 py-1.5 text-sm ${amount === v ? 'bg-brand text-white' : 'bg-raised text-dim'}`}>₹{v.toLocaleString('en-IN')}</button>
      ))}</div>
      <input type="number" inputMode="numeric" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="input text-center font-display text-3xl" aria-label="Amount" />
      {save100 > 0 && <p className="text-center text-xs text-good">₹100 today saves about ₹{(save100 * amount / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })} in interest on ₹{amount.toLocaleString('en-IN')}</p>}
      <p className="text-center text-xs text-mute">{strings.anyAmount}</p>
      {vpa ? <a href={upi} className="btn-primary w-full py-3 text-base">{strings.payNow} · UPI</a> : <p className="text-sm text-warn">UPI is not set up for this lender yet.</p>}
      <form action={act} className="card space-y-3 p-4">
        <input type="hidden" name="amount" value={amount} />
        <label className="label" htmlFor="utr">{strings.utr}</label>
        <input id="utr" name="utr" className="input" placeholder="412345678901" required />
        {s?.error && <p role="alert" className="text-sm text-bad">{s.error}</p>}
        <button className="btn-ghost w-full" disabled={pending}>{strings.report}</button>
      </form>
    </div>
  );
}
