'use client';
import { useActionState, useRef, useState } from 'react';
import { HoldButton } from './form';

type R = { error?: string; ok?: string } | undefined;
type Act = (s: R, f: FormData) => Promise<R>;

/** Disbursal: details, then press-and-hold to confirm the money movement. */
export function DisburseForm({ action, net, today }: { action: Act; net: string; today: string }) {
  const [state, act, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={act} className="grid gap-3 sm:grid-cols-2">
      <div><label className="label" htmlFor="mode">Pay by</label><select id="mode" name="mode" className="input" defaultValue="CASH"><option value="CASH">Cash at counter</option><option value="UPI">UPI</option><option value="NEFT">NEFT / IMPS</option><option value="CHEQUE">Cheque</option></select></div>
      <div><label className="label" htmlFor="date">Date</label><input id="date" name="date" type="date" defaultValue={today} max={today} className="input" /></div>
      <div><label className="label" htmlFor="reference">Reference (UTR / cheque no.)</label><input id="reference" name="reference" className="input" /></div>
      <div><label className="label" htmlFor="payee">Paid to (if a supplier)</label><input id="payee" name="payee" className="input" placeholder="Borrower" /></div>
      <div className="sm:col-span-2"><label className="flex items-center gap-2 text-sm text-dim"><input type="checkbox" name="deductFee" value="yes" defaultChecked onChange={(e) => { if (!e.target.checked) e.target.value = 'no'; }} />Deduct processing charges + GST from the amount paid out</label></div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <HoldButton label={pending ? 'Disbursing…' : `Hold to disburse ${net}`} onConfirm={() => ref.current?.requestSubmit()} />
        <span className="text-xs text-mute">Irreversible. Posts to the books and starts the schedule.</span>
      </div>
      {state?.error && <p role="alert" className="text-sm text-bad sm:col-span-2">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-good sm:col-span-2">{state.ok}</p>}
    </form>
  );
}

/** A canvas signature pad that writes a PNG data URL into a hidden input. */
export function SignaturePad({ name = 'signature' }: { name?: string }) {
  const c = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState('');
  const drawing = useRef(false);
  const pos = (e: React.PointerEvent) => { const r = c.current!.getBoundingClientRect(); return [(e.clientX - r.left) * (c.current!.width / r.width), (e.clientY - r.top) * (c.current!.height / r.height)]; };
  return (
    <div>
      <canvas ref={c} width={560} height={160} className="w-full touch-none rounded-xl border border-line bg-white" aria-label="Sign here"
        onPointerDown={(e) => { drawing.current = true; const x = c.current!.getContext('2d')!; x.lineWidth = 2.2; x.lineCap = 'round'; x.strokeStyle = '#111'; const [a, b] = pos(e); x.beginPath(); x.moveTo(a, b); }}
        onPointerMove={(e) => { if (!drawing.current) return; const x = c.current!.getContext('2d')!; const [a, b] = pos(e); x.lineTo(a, b); x.stroke(); }}
        onPointerUp={() => { drawing.current = false; setData(c.current!.toDataURL('image/png')); }} />
      <div className="mt-1 flex justify-between text-xs text-mute"><span>Sign inside the box</span><button type="button" onClick={() => { c.current!.getContext('2d')!.clearRect(0, 0, 560, 160); setData(''); }}>Clear</button></div>
      <input type="hidden" name={name} value={data} />
    </div>
  );
}
