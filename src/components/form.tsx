'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';

type R = { error?: string; ok?: string } | undefined;
type Act = (s: R, f: FormData) => Promise<R>;

/** A form bound to a server action, with inline success/error feedback. */
export function ActionForm({ action, children, className, submit, submitClass, confirm, reset }: {
  action: Act; children?: React.ReactNode; className?: string; submit?: string; submitClass?: string; confirm?: string; reset?: boolean;
}) {
  const [state, act, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && reset) ref.current?.reset();
    // announce results globally too, so they stay visible even if this form unmounts after the page updates
    if (state?.ok || state?.error) window.dispatchEvent(new CustomEvent('finx-toast', { detail: state }));
  }, [state, reset]);
  return (
    <form ref={ref} action={act} className={className} onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      {children}
      {submit && <button className={clsx(submitClass ?? 'btn-primary', 'mt-1')} disabled={pending}>{pending ? 'Working…' : submit}</button>}
      {state?.error && <p role="alert" className="mt-2 text-sm text-bad">{state.error}</p>}
      {state?.ok && <p role="status" className="mt-2 text-sm text-good">{state.ok}</p>}
    </form>
  );
}

export function Field({ label, name, type = 'text', defaultValue, required, placeholder, step, min, max, hint, className }: {
  label: string; name: string; type?: string; defaultValue?: string | number | null; required?: boolean; placeholder?: string; step?: string; min?: string | number; max?: string | number; hint?: string; className?: string;
}) {
  return (
    <div className={className}>
      <label className="label" htmlFor={name}>{label}{required && <span className="text-bad"> *</span>}</label>
      <input id={name} name={name} type={type} defaultValue={defaultValue ?? undefined} required={required} placeholder={placeholder} step={step} min={min} max={max} className="input" />
      {hint && <p className="mt-1 text-xs text-mute">{hint}</p>}
    </div>
  );
}

export function Select({ label, name, options, defaultValue, required, className, onChange }: {
  label: string; name: string; options: [string, string][]; defaultValue?: string | null; required?: boolean; className?: string; onChange?: (v: string) => void;
}) {
  return (
    <div className={className}>
      <label className="label" htmlFor={name}>{label}{required && <span className="text-bad"> *</span>}</label>
      <select id={name} name={name} defaultValue={defaultValue ?? undefined} required={required} className="input" onChange={(e) => onChange?.(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

/** A disclosure that holds an action form — keeps detail pages calm until an action is needed. */
export function Drawer({ label, children, tone = 'ghost', open: initial = false }: { label: string; children: React.ReactNode; tone?: 'ghost' | 'primary' | 'danger'; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <div>
      <button type="button" className={tone === 'primary' ? 'btn-primary' : tone === 'danger' ? 'btn-danger' : 'btn-ghost'} aria-expanded={open} onClick={() => setOpen(!open)}>{label}</button>
      {open && <div className="mt-3 rounded-xl border border-line bg-raised/60 p-4">{children}</div>}
    </div>
  );
}

/** Press-and-hold confirmation for irreversible money movements (as in the website console). */
export function HoldButton({ label, onConfirm, ms = 1000 }: { label: string; onConfirm: () => void; ms?: number }) {
  const [p, setP] = useState(0);
  const t = useRef<number | null>(null);
  const start = () => {
    const t0 = performance.now();
    const tick = () => { const v = Math.min(1, (performance.now() - t0) / ms); setP(v); if (v >= 1) { stop(); onConfirm(); } else t.current = requestAnimationFrame(tick); };
    t.current = requestAnimationFrame(tick);
  };
  const stop = () => { if (t.current) cancelAnimationFrame(t.current); t.current = null; setP((v) => (v >= 1 ? v : 0)); };
  return (
    <button type="button" className="btn-primary relative overflow-hidden" onPointerDown={start} onPointerUp={stop} onPointerLeave={stop}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !t.current) { e.preventDefault(); start(); } }} onKeyUp={stop} aria-describedby="hold-hint">
      <span className="absolute inset-y-0 left-0 bg-white/25" style={{ width: `${p * 100}%` }} aria-hidden />
      <span className="relative">{label}</span>
      <span id="hold-hint" className="sr-only">Press and hold for one second to confirm.</span>
    </button>
  );
}

/** Shows the latest action result for a few seconds (bottom-right), announced to screen readers. */
export function Toaster() {
  const [t, setT] = useState<{ ok?: string; error?: string; k: number } | null>(null);
  useEffect(() => {
    const on = (e: Event) => setT({ ...(e as CustomEvent).detail, k: Date.now() });
    window.addEventListener('finx-toast', on);
    return () => window.removeEventListener('finx-toast', on);
  }, []);
  useEffect(() => { if (!t) return; const id = setTimeout(() => setT(null), 6000); return () => clearTimeout(id); }, [t]);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 max-w-sm">
      {t && <div key={t.k} className={clsx('pointer-events-auto rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur', t.error ? 'border-bad/40 bg-bad/15 text-bad' : 'border-good/40 bg-panel/95 text-good')}>{t.error ?? t.ok}</div>}
    </div>
  );
}
