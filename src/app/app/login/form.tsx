'use client';
import { useActionState } from 'react';
import { otpAction } from '../actions';

export function OtpForm() {
  const [s, act, pending] = useActionState(otpAction, undefined);
  return (
    <form action={act} className="space-y-4">
      <div><label className="label" htmlFor="phone">Mobile number · மொபைல் எண் · मोबाइल नंबर</label>
        <input id="phone" name="phone" inputMode="numeric" autoComplete="tel" className="input text-lg" defaultValue={s?.phone} readOnly={s?.sent} required placeholder="98400 12345" /></div>
      {s?.sent && <div><label className="label" htmlFor="code">6-digit code · குறியீடு · कोड</label><input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="input text-center text-2xl tracking-[0.5em]" required autoFocus /></div>}
      {s?.demoCode && <p className="rounded-lg bg-warn/10 p-2 text-center text-xs text-warn">Demo mode (no SMS gateway yet): your code is <b>{s.demoCode}</b></p>}
      {s?.error && <p role="alert" className="text-sm text-bad">{s.error}</p>}
      <button className="btn-primary w-full py-3 text-base" disabled={pending}>{pending ? '…' : s?.sent ? 'Verify' : 'Get code'}</button>
    </form>
  );
}
