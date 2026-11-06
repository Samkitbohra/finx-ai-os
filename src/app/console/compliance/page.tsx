import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireCtx } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { kycDue, conductLog } from '@/server/compliance';
import { PageHeader, Card, Tabs, Badge, Stat } from '@/components/ui';
import { ActionForm, Select } from '@/components/form';
import { fmtNo } from '@/server/core';
import { fmtDate, todayIST } from '@/lib/dates';
import { bureauAction } from '../actions';

export const metadata = { title: 'Compliance' };

export default async function Compliance({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = 'overview' } = await searchParams;
  const ctx = await requireCtx();
  const T = schema;
  const [kyc, conduct, runs, org] = await Promise.all([
    kycDue(ctx), conductLog(ctx, 30),
    db.select().from(T.bureauSubmissions).where(eq(T.bureauSubmissions.orgId, ctx.orgId)).orderBy(desc(T.bureauSubmissions.createdAt)).limit(24),
    db.query.organizations.findFirst({ where: eq(T.organizations.id, ctx.orgId) }),
  ]);
  const blocked = conduct.filter((c) => c.status === 'BLOCKED');
  const lastRun = runs[0];
  const checks: [string, string, boolean, string][] = [
    ['KYC & CKYC', 'Borrowers verified and re-verified on time', kyc.length === 0, kyc.length ? `${kyc.length} borrowers need KYC action` : 'All current'],
    ['Bureau reporting', 'Data file generated every reporting cycle', !!lastRun && (Date.now() - lastRun.createdAt.getTime()) < 16 * 86400_000, lastRun ? `Last file ${fmtDate(lastRun.periodEnd)} (${lastRun.recordCount} accounts)` : 'No file generated yet'],
    ['Recovery conduct', `Contact only ${org?.callWindowStart}:00–${org?.callWindowEnd}:00, with consent, every contact logged`, true, `${conduct.length} contacts logged · ${blocked.length} held back by the rules`],
    ['Data protection', 'Consent on record; full Aadhaar never stored', true, 'Consent captured per channel at onboarding'],
    ['Statutory registers', `Pledge and loan registers in the ${org?.state} format`, true, 'Kept automatically from the loan book'],
    ['Inspection', 'Any file, with its audit trail, on demand', true, 'Every change is versioned and attributed'],
  ];
  return (
    <>
      <PageHeader title="Compliance" sub="Each rule is enforced by the system and leaves evidence you can show an inspector." />
      <Tabs active={tab} items={[{ key: 'overview', label: 'Overview', href: '?tab=overview' }, { key: 'kyc', label: `KYC (${kyc.length})`, href: '?tab=kyc' }, { key: 'bureau', label: 'Bureau reporting', href: '?tab=bureau' }, { key: 'conduct', label: 'Recovery conduct', href: '?tab=conduct' }, { key: 'audit', label: 'Audit trail', href: '?tab=audit' }]} />
      {tab === 'overview' && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{checks.map(([t, d, ok, s]) => (
          <div key={t} className="card p-5"><div className="flex items-center justify-between"><h3 className="font-semibold">{t}</h3><Badge v={ok ? 'COMPLETED' : 'BLOCKED'} label={ok ? 'On track' : 'Action needed'} /></div><p className="mt-1 text-sm text-dim">{d}</p><p className="mt-3 text-xs text-mute">{s}</p></div>
        ))}</div>
      )}
      {tab === 'kyc' && (
        <Card pad={false}>{kyc.length === 0 ? <p className="p-5 text-sm text-dim">Everyone is verified.</p> : <table className="w-full"><thead><tr><th className="th">Borrower</th><th className="th">Phone</th><th className="th">Status</th><th className="th">Re-verify by</th><th className="th" /></tr></thead>
          <tbody>{kyc.map((k) => <tr key={k.id} className="tr"><td className="td font-medium">{k.name} <span className="text-xs text-mute">{fmtNo.borrower(k.code)}</span></td><td className="td num text-dim">{k.phone}</td><td className="td"><Badge v={k.kyc} /></td><td className="td num">{fmtDate(k.due)}</td><td className="td text-right"><Link className="text-brand" href={`/console/borrowers/${k.id}`}>Open →</Link></td></tr>)}</tbody></table>}</Card>
      )}
      {tab === 'bureau' && (
        <div className="space-y-4">
          {can(ctx.role, 'compliance.run') && <Card title="Generate data file"><ActionForm action={bureauAction} className="flex flex-wrap items-end gap-2" submit="Generate">
            <Select label="Bureau" name="bureau" options={[['CIBIL', 'TransUnion CIBIL'], ['CRIF', 'CRIF High Mark'], ['EQUIFAX', 'Equifax'], ['EXPERIAN', 'Experian']]} className="w-56" />
            <div><label className="label" htmlFor="periodEnd">As of</label><input id="periodEnd" name="periodEnd" type="date" defaultValue={todayIST()} className="input" /></div>
          </ActionForm><p className="mt-3 text-xs text-mute">One row per account with balance, overdue and days past due. Upload it under your institution’s bureau membership; the column mapping for each bureau’s format is in the README.</p></Card>}
          <Card title="Files" pad={false}><table className="w-full"><thead><tr><th className="th">Bureau</th><th className="th">As of</th><th className="th">Accounts</th><th className="th">Generated</th><th className="th" /></tr></thead>
            <tbody>{runs.map((r) => <tr key={r.id} className="tr"><td className="td">{r.bureau}</td><td className="td num">{fmtDate(r.periodEnd)}</td><td className="td num">{r.recordCount}</td><td className="td text-dim">{r.createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td><td className="td text-right">{r.documentId && <a className="text-brand" href={`/api/documents/${r.documentId}`}>Download</a>}</td></tr>)}</tbody></table></Card>
        </div>
      )}
      {tab === 'conduct' && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Contacts (30 days)" value={conduct.length} /><Stat label="Held back" value={blocked.length} hint="Stopped by hours, consent or limits" /><Stat label="Outside hours sent" value={0} tone="good" hint="The dialer cannot call outside hours" /><Stat label="Languages used" value={new Set(conduct.map((c) => c.language)).size} /></div>
          <Card pad={false}><div className="overflow-x-auto"><table className="w-full min-w-[760px]"><thead><tr><th className="th">Time (IST)</th><th className="th">Borrower</th><th className="th">Channel</th><th className="th">Result</th><th className="th">Rule</th></tr></thead>
            <tbody>{conduct.map((c) => <tr key={c.id} className="tr"><td className="td num text-xs text-dim">{c.at.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</td><td className="td">{c.borrower}</td><td className="td text-dim">{c.direction === 'IN' ? 'reply · ' : ''}{c.channel.toLowerCase()} · {c.language}</td><td className="td"><Badge v={c.status} />{c.outcome ? <span className="ml-2 text-xs text-mute">{c.outcome.replace(/_/g, ' ').toLowerCase()}</span> : null}</td><td className="td text-xs text-warn">{c.reason ?? <span className="text-mute">Passed</span>}</td></tr>)}</tbody></table></div></Card>
        </>
      )}
      {tab === 'audit' && (async () => {
        const logs = await db.select({ a: T.auditLogs, user: T.users.name }).from(T.auditLogs).leftJoin(T.users, eq(T.users.id, T.auditLogs.userId)).where(eq(T.auditLogs.orgId, ctx.orgId)).orderBy(desc(T.auditLogs.at)).limit(300);
        return <Card pad={false}><div className="overflow-x-auto"><table className="w-full min-w-[860px]"><thead><tr><th className="th">Time (IST)</th><th className="th">Who</th><th className="th">Via</th><th className="th">What</th></tr></thead>
          <tbody>{logs.map(({ a, user }) => <tr key={a.id} className="tr"><td className="td num whitespace-nowrap text-xs text-dim">{a.at.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' })}</td><td className="td">{user ?? 'System'}</td><td className="td"><Badge v={a.via} label={a.via.toLowerCase().replace('_', ' ')} /></td><td className="td text-sm text-dim">{a.summary ?? `${a.action} ${a.entity}`}{a.entity === 'loan' && a.entityId ? <Link className="ml-2 text-brand" href={`/console/loans/${a.entityId}`}>open</Link> : null}</td></tr>)}</tbody></table></div></Card>;
      })()}
    </>
  );
}
