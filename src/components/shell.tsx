'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { I } from './icons';
import { Toaster } from './form';

const NAV: { group: string; items: { href: string; label: string; icon: keyof typeof I; badge?: string }[] }[] = [
  { group: 'Book', items: [
    { href: '/console', label: 'Portfolio', icon: 'home' },
    { href: '/console/loans', label: 'Loans', icon: 'loan', badge: 'loans' },
    { href: '/console/borrowers', label: 'Borrowers', icon: 'users' },
    { href: '/console/approvals', label: 'Approvals', icon: 'check', badge: 'approvals' },
    { href: '/console/collateral', label: 'Collateral & vault', icon: 'vault' },
  ] },
  { group: 'Operations', items: [
    { href: '/console/collections', label: 'Collections', icon: 'phone', badge: 'overdue' },
    { href: '/console/accounting', label: 'Accounting', icon: 'book' },
    { href: '/console/registers', label: 'Registers', icon: 'register' },
    { href: '/console/compliance', label: 'Compliance', icon: 'shield' },
    { href: '/console/analytics', label: 'Analytics & MIS', icon: 'chart' },
  ] },
  { group: 'Assistant', items: [{ href: '/console/ai', label: 'FinX AI', icon: 'spark' }] },
  { group: 'Admin', items: [{ href: '/console/settings', label: 'Settings', icon: 'settings' }] },
];

export function Shell({ user, org, counts, children }: { user: { name: string; role: string; branch: string | null }; org: string; counts: Record<string, number>; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [q, setQ] = useState('');
  useEffect(() => { setTheme((document.documentElement.dataset.theme as 'dark' | 'light') ?? 'dark'); }, []);
  useEffect(() => setOpen(false), [path]);
  const toggle = () => {
    const t = theme === 'dark' ? 'light' : 'dark';
    setTheme(t); document.documentElement.dataset.theme = t;
    try { localStorage.setItem('finx-theme', t); } catch {}
  };
  const active = (href: string) => (href === '/console' ? path === href : path.startsWith(href));

  const nav = (
    <nav className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-5" aria-label="Main">
      <Link href="/console" className="px-2 font-display text-xl font-semibold tracking-tight">FinX <span className="grad">AI</span></Link>
      <div className="px-2 text-xs text-mute">{org}</div>
      {NAV.map((g) => (
        <div key={g.group}>
          <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-mute">{g.group}</div>
          <ul className="space-y-0.5">
            {g.items.map((it) => {
              const Ico = I[it.icon];
              const n = it.badge ? counts[it.badge] : 0;
              return (
                <li key={it.href}>
                  <Link href={it.href} aria-current={active(it.href) ? 'page' : undefined}
                    className={clsx('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm', active(it.href) ? 'bg-brand/12 text-ink ring-1 ring-brand/30' : 'text-dim hover:bg-raised hover:text-ink')}>
                    <Ico className="h-4 w-4" />
                    <span className="flex-1">{it.label}</span>
                    {n ? <span className={clsx('num rounded-md px-1.5 text-[11px]', it.badge === 'overdue' ? 'bg-bad/15 text-bad' : 'bg-raised text-mute')}>{n}</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="mt-auto rounded-xl border border-line bg-raised/60 p-3">
        <div className="text-sm font-medium">{user.name}</div>
        <div className="text-xs text-mute">{user.role}{user.branch ? ` · ${user.branch}` : ''}</div>
        <form action="/api/auth/logout" method="post" className="mt-2">
          <button className="inline-flex items-center gap-1.5 text-xs text-dim hover:text-ink"><I.out className="h-3.5 w-3.5" />Sign out</button>
        </form>
      </div>
    </nav>
  );

  return (
    <div className="bloom min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-brand focus:px-3 focus:py-1 focus:text-white">Skip to content</a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-line bg-panel/80 backdrop-blur lg:block">{nav}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <button className="absolute inset-0 bg-black/50" aria-label="Close menu" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-line bg-panel">{nav}</aside>
        </div>
      )}
      <div className="lg:pl-60">
        <header className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-bg/80 px-4 py-3 backdrop-blur md:px-8">
          <button className="btn-ghost px-2.5 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><I.menu /></button>
          <form className="relative flex-1 max-w-xl" onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/console/loans?q=${encodeURIComponent(q.trim())}`); }}>
            <I.search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" />
            <input value={q} onChange={(e) => setQ(e.target.value)} className="input pl-9" placeholder="Search borrower, phone or loan number" aria-label="Search" />
          </form>
          <Link href="/console/ai" className="btn-ghost hidden sm:inline-flex"><I.spark />Ask FinX AI</Link>
          <button className="btn-ghost px-2.5" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>{theme === 'dark' ? <I.sun /> : <I.moon />}</button>
        </header>
        <main id="main" className="mx-auto max-w-[1400px] px-4 py-6 md:px-8 md:py-8">{children}</main>
        <Toaster />
      </div>
    </div>
  );
}
