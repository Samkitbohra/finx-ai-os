import Link from 'next/link';
import clsx from 'clsx';
import { fmtP, fmtCompact, toPaise } from '@/lib/money';

export function PageHeader({ title, sub, actions, back }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {back && <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-xs text-mute hover:text-ink">← {back.label}</Link>}
        <h1 className="font-display text-2xl font-semibold tracking-tight md:text-[28px]">{title}</h1>
        {sub && <p className="mt-1 text-sm text-dim">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, pad = true }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={clsx('card', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      <div className={pad ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, delta, tone, hint }: { label: string; value: React.ReactNode; delta?: { text: string; good: boolean } | null; tone?: 'good' | 'bad' | 'warn'; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-mute">{label}</div>
      <div className={clsx('num mt-2 font-display text-[26px] font-semibold tracking-tight', tone === 'bad' && 'text-bad', tone === 'good' && 'text-good', tone === 'warn' && 'text-warn')}>{value}</div>
      {delta && <div className={clsx('mt-1 text-xs font-medium', delta.good ? 'text-good' : 'text-bad')}>{delta.good ? '▲' : '▼'} {delta.text}</div>}
      {hint && !delta && <div className="mt-1 text-xs text-mute">{hint}</div>}
    </div>
  );
}

const TONES: Record<string, string> = {
  ACTIVE: 'bg-brand/15 text-brand', CLOSED: 'bg-good/15 text-good', PENDING_APPROVAL: 'bg-warn/15 text-warn', APPROVED: 'bg-brand/15 text-brand',
  DRAFT: 'bg-mute/15 text-mute', REJECTED: 'bg-bad/15 text-bad', WRITTEN_OFF: 'bg-bad/15 text-bad', AUCTIONED: 'bg-bad/15 text-bad',
  VERIFIED: 'bg-good/15 text-good', PENDING: 'bg-warn/15 text-warn', EXPIRED: 'bg-bad/15 text-bad', PAID: 'bg-good/15 text-good', PARTIAL: 'bg-warn/15 text-warn', DUE: 'bg-mute/15 text-dim',
  PLEDGED: 'bg-brand/15 text-brand', RELEASED: 'bg-good/15 text-good', DELIVERED: 'bg-good/15 text-good', SENT: 'bg-brand/15 text-brand', COMPLETED: 'bg-good/15 text-good',
  BLOCKED: 'bg-warn/15 text-warn', FAILED: 'bg-bad/15 text-bad', SCHEDULED: 'bg-mute/15 text-dim', ISSUED: 'bg-brand/15 text-brand', REISSUED: 'bg-mute/15 text-mute', CANCELLED: 'bg-bad/15 text-bad',
};
export function Badge({ v, label }: { v: string; label?: string }) {
  return <span className={clsx('chip', TONES[v] ?? 'bg-mute/15 text-dim')}>{label ?? v.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</span>;
}

export function Dpd({ d }: { d: number }) {
  if (d === 0) return <span className="chip bg-good/15 text-good">Current</span>;
  return <span className={clsx('chip', d > 90 ? 'bg-bad/20 text-bad' : d > 30 ? 'bg-bad/15 text-bad' : 'bg-warn/15 text-warn')}>{d} days late</span>;
}

/** Money from a NUMERIC string or rupees number. */
export const M = ({ v, dp, compact, className }: { v: string | number | null | undefined; dp?: boolean; compact?: boolean; className?: string }) => {
  const p = toPaise(v ?? 0);
  return <span className={clsx('num', className)}>{compact ? fmtCompact(p / 100) : fmtP(p, dp)}</span>;
};

export function Empty({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-12 text-center">
      <div className="font-medium">{title}</div>
      {sub && <p className="mt-1 max-w-md text-sm text-dim">{sub}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Tabs({ items, active }: { items: { href: string; label: string; key: string }[]; active: string }) {
  return (
    <nav className="mb-5 flex flex-wrap gap-1 rounded-xl border border-line bg-panel p-1" aria-label="Sections">
      {items.map((t) => (
        <Link key={t.key} href={t.href} className={clsx('tab', t.key === active && 'tab-on')} aria-current={t.key === active ? 'page' : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}

export function KV({ rows }: { rows: [React.ReactNode, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(110px,40%)_1fr] gap-x-4 gap-y-2.5 text-sm">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-mute">{k}</dt>
          <dd className="num text-ink">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Table({ head, children, empty }: { head: React.ReactNode[]; children: React.ReactNode; empty?: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px]">
        <thead><tr>{head.map((h, i) => <th key={i} className="th">{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export function Avatar({ name }: { name: string }) {
  const ini = name.split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase();
  return <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand/15 text-[11px] font-semibold text-brand">{ini}</span>;
}

/** Simple grouped bar chart (two series), drawn as SVG on the server. */
export function BarPair({ data, labels }: { data: { label: string; a: number; b: number }[]; labels: [string, string] }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b]));
  const W = 640, H = 220, pad = 28, gw = (W - pad) / data.length;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <figure>
      <div className="mb-3 flex gap-4 text-xs text-dim">
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-brand" />{labels[0]}</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-good" />{labels[1]}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 24}`} className="w-full" role="img" aria-label={`${labels[0]} and ${labels[1]} by month`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad} x2={W} y1={H - t * (H - 10)} y2={H - t * (H - 10)} stroke="rgb(var(--line))" strokeDasharray={t ? '3 4' : undefined} />
            <text x={0} y={H - t * (H - 10) + 4} fontSize="10" fill="rgb(var(--mute))">{t ? fmtCompact((max * t) / 100).replace('₹', '') : '0'}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad + i * gw + gw * 0.18, bw = gw * 0.3;
          const ha = (d.a / max) * (H - 10), hb = (d.b / max) * (H - 10);
          return (
            <g key={d.label}>
              <rect x={x} y={H - ha} width={bw} height={ha} rx={3} fill="rgb(var(--brand))"><title>{`${d.label} ${labels[0]}: ${fmtCompact(d.a / 100)}`}</title></rect>
              <rect x={x + bw + 4} y={H - hb} width={bw} height={hb} rx={3} fill="rgb(var(--good))"><title>{`${d.label} ${labels[1]}: ${fmtCompact(d.b / 100)}`}</title></rect>
              <text x={x + bw} y={H + 16} fontSize="11" textAnchor="middle" fill="rgb(var(--mute))">{d.label}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export const ASSET_LABEL: Record<string, string> = { GOLD: 'Gold', VEHICLE: 'Vehicle', PROPERTY: 'Property', MACHINERY: 'Machinery', BUSINESS: 'Business', UNSECURED: 'Unsecured' };
export const METHOD_LABEL: Record<string, string> = { FLAT: 'Flat', REDUCING: 'Reducing', DAILY: 'Daily accrual' };
export const FREQ_LABEL: Record<string, string> = { MONTHLY: 'Monthly', WEEKLY: 'Weekly', DAILY: 'Daily', BULLET: 'Interest monthly, principal at end' };
export const TENURE_UNIT: Record<string, string> = { MONTHLY: 'months', BULLET: 'months', WEEKLY: 'weeks', DAILY: 'days' };
