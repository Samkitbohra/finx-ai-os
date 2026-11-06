import { and, asc, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireCtx } from '@/lib/auth';
import { can, ROLE_LABEL } from '@/lib/permissions';
import { PageHeader, Card, Tabs, Badge, ASSET_LABEL, METHOD_LABEL } from '@/components/ui';
import { ActionForm, Field, Select, Drawer } from '@/components/form';
import { LANGUAGES, TEMPLATE_KEYS } from '@/server/agent';
import { channelStatus } from '@/server/channels';
import { llmEnabled } from '@/lib/llm';
import * as act from '../actions';

export const metadata = { title: 'Settings' };

export default async function Settings({ searchParams }: { searchParams: Promise<{ tab?: string; lang?: string }> }) {
  const { tab = 'org', lang = 'ta' } = await searchParams;
  const ctx = await requireCtx();
  const T = schema;
  const w = can(ctx.role, 'settings.write');
  const [org, branches, users, products, templates, keys] = await Promise.all([
    db.query.organizations.findFirst({ where: eq(T.organizations.id, ctx.orgId) }),
    db.select().from(T.branches).where(eq(T.branches.orgId, ctx.orgId)).orderBy(asc(T.branches.code)),
    db.select().from(T.users).where(eq(T.users.orgId, ctx.orgId)).orderBy(asc(T.users.name)),
    db.select().from(T.products).where(eq(T.products.orgId, ctx.orgId)).orderBy(asc(T.products.assetType)),
    db.select().from(T.messageTemplates).where(eq(T.messageTemplates.orgId, ctx.orgId)),
    db.select().from(T.apiKeys).where(and(eq(T.apiKeys.orgId, ctx.orgId), eq(T.apiKeys.revoked, false))).orderBy(desc(T.apiKeys.createdAt)),
  ]);
  if (!org) return null;
  const live = channelStatus();
  const roleOpts = Object.entries(ROLE_LABEL) as [string, string][];
  return (
    <>
      <PageHeader title="Settings" sub={w ? undefined : 'Read-only for your role.'} />
      <Tabs active={tab} items={[
        { key: 'org', label: 'Organisation', href: '?tab=org' }, { key: 'branches', label: 'Branches', href: '?tab=branches' }, { key: 'users', label: 'Staff & roles', href: '?tab=users' },
        { key: 'products', label: 'Products', href: '?tab=products' }, { key: 'scripts', label: 'Scripts & languages', href: '?tab=scripts' }, { key: 'channels', label: 'Channels', href: '?tab=channels' }, { key: 'api', label: 'API', href: '?tab=api' },
      ]} />

      {tab === 'org' && (
        <Card title="Organisation">
          <ActionForm action={act.orgAction} className="grid gap-3 sm:grid-cols-3" submit={w ? 'Save' : undefined}>
            <Field label="Trading name" name="name" defaultValue={org.name} required /><Field label="Legal name" name="legalName" defaultValue={org.legalName} /><Field label="Licence no." name="licenseNo" defaultValue={org.licenseNo} />
            <Field label="State (registers format)" name="state" defaultValue={org.state} /><Field label="GSTIN" name="gstin" defaultValue={org.gstin} /><Field label="PAN" name="pan" defaultValue={org.pan} />
            <Field label="Address" name="address" defaultValue={org.address} className="sm:col-span-2" /><Field label="Phone" name="phone" defaultValue={org.phone} />
            <Field label="Email" name="email" defaultValue={org.email} /><Field label="UPI ID for borrower payments" name="upiVpa" defaultValue={org.upiVpa} /><Select label="Default language" name="defaultLanguage" options={Object.entries(LANGUAGES)} defaultValue={org.defaultLanguage} />
            <Field label="Contact from (hour)" name="callWindowStart" type="number" min={7} max={20} defaultValue={org.callWindowStart} hint="Calls and messages only inside these hours" />
            <Field label="Contact until (hour)" name="callWindowEnd" type="number" min={7} max={20} defaultValue={org.callWindowEnd} />
            <Field label="Max contacts per borrower per day" name="maxContactsPerDay" type="number" min={1} max={5} defaultValue={org.maxContactsPerDay} />
          </ActionForm>
        </Card>
      )}

      {tab === 'branches' && (
        <Card title="Branches" pad={false}>
          <table className="w-full"><thead><tr><th className="th">Code</th><th className="th">Name</th><th className="th">City</th><th className="th">Address</th></tr></thead>
            <tbody>{branches.map((b) => <tr key={b.id} className="tr"><td className="td num">{b.code}</td><td className="td font-medium">{b.name}</td><td className="td text-dim">{b.city}</td><td className="td text-dim">{b.address}</td></tr>)}</tbody></table>
          {w && <div className="p-5"><Drawer label="Add branch"><ActionForm action={act.branchAction} className="grid gap-2 sm:grid-cols-4" submit="Add branch" reset>
            <Field label="Code" name="code" required /><Field label="Name" name="name" required /><Field label="City" name="city" /><Field label="Address" name="address" />
          </ActionForm></Drawer></div>}
        </Card>
      )}

      {tab === 'users' && (
        <Card title="Staff & roles" pad={false}>
          <table className="w-full"><thead><tr><th className="th">Name</th><th className="th">Email</th><th className="th">Role</th><th className="th">Branch</th><th className="th">Status</th></tr></thead>
            <tbody>{users.map((u) => <tr key={u.id} className="tr"><td className="td font-medium">{u.name}</td><td className="td text-dim">{u.email}</td><td className="td">{ROLE_LABEL[u.role]}</td><td className="td text-dim">{branches.find((b) => b.id === u.branchId)?.name ?? 'All branches'}</td><td className="td"><Badge v={u.active ? 'COMPLETED' : 'CANCELLED'} label={u.active ? 'Active' : 'Disabled'} /></td></tr>)}</tbody></table>
          {can(ctx.role, 'users.write') && <div className="p-5"><Drawer label="Add staff member"><ActionForm action={act.userAction} className="grid gap-2 sm:grid-cols-3" submit="Add" reset>
            <Field label="Name" name="name" required /><Field label="Email" name="email" type="email" required /><Field label="Phone" name="phone" />
            <Select label="Role" name="role" options={roleOpts} defaultValue="LOAN_OFFICER" /><Select label="Branch" name="branchId" options={[['', 'All branches'], ...branches.map((b) => [b.id, b.name] as [string, string])]} />
            <Field label="Temporary password" name="password" type="password" required hint="At least 8 characters" />
          </ActionForm></Drawer></div>}
          <div className="border-t border-line p-5 text-xs text-mute">Owners and admins see every branch. Branch managers approve and disburse. Loan officers create loans but cannot approve their own. Auditors can read everything and change nothing.</div>
        </Card>
      )}

      {tab === 'products' && (
        <Card title="Loan products" pad={false}>
          <div className="overflow-x-auto"><table className="w-full min-w-[900px]"><thead><tr><th className="th">Product</th><th className="th">Asset</th><th className="th">Interest</th><th className="th">Rate</th><th className="th">Amount</th><th className="th">Tenure</th><th className="th">Max LTV</th><th className="th">Fee</th><th className="th">Grace</th></tr></thead>
            <tbody>{products.map((p) => <tr key={p.id} className="tr"><td className="td font-medium">{p.name}</td><td className="td text-dim">{ASSET_LABEL[p.assetType]}</td><td className="td text-dim">{METHOD_LABEL[p.interestMethod]} · {p.frequency.toLowerCase()}</td><td className="td num">{Number(p.annualRate)}% <span className="text-xs text-mute">(+{Number(p.penalRate)}% penal)</span></td><td className="td num text-dim">₹{Number(p.minAmount).toLocaleString('en-IN')}–{Number(p.maxAmount).toLocaleString('en-IN')}</td><td className="td num text-dim">{p.minTenure}–{p.maxTenure}</td><td className="td num">{p.maxLtv ? `${Number(p.maxLtv)}%${p.ltvTiers ? ' (tiered)' : ''}` : '—'}</td><td className="td num text-dim">{Number(p.processingFeePct)}% + {Number(p.gstRate)}% GST</td><td className="td num text-dim">{p.graceDays} d</td></tr>)}</tbody></table></div>
          {w && <div className="p-5"><Drawer label="Add product"><ActionForm action={act.productAction} className="grid gap-2 sm:grid-cols-4" submit="Save product" reset>
            <Field label="Name" name="name" required /><Select label="Asset" name="assetType" options={Object.entries(ASSET_LABEL)} /><Select label="Interest method" name="interestMethod" options={Object.entries(METHOD_LABEL)} />
            <Select label="Repayment" name="frequency" options={[['MONTHLY', 'Monthly'], ['WEEKLY', 'Weekly'], ['DAILY', 'Daily'], ['BULLET', 'Interest monthly, principal at end']]} />
            <Field label="Rate % / year" name="annualRate" type="number" step="0.01" required /><Field label="Penal % / year" name="penalRate" type="number" step="0.01" defaultValue="2" />
            <Field label="Min amount" name="minAmount" type="number" /><Field label="Max amount" name="maxAmount" type="number" /><Field label="Min tenure" name="minTenure" type="number" /><Field label="Max tenure" name="maxTenure" type="number" />
            <Field label="Max LTV % (blank = unsecured)" name="maxLtv" type="number" /><Field label="Processing fee %" name="processingFeePct" type="number" step="0.01" defaultValue="1" /><Field label="Grace days" name="graceDays" type="number" defaultValue="3" />
          </ActionForm></Drawer></div>}
        </Card>
      )}

      {tab === 'scripts' && (
        <>
          <div className="mb-4 flex flex-wrap gap-1.5">{Object.entries(LANGUAGES).map(([k, v]) => {
            const n = templates.filter((t) => t.language === k && t.approved).length;
            return <a key={k} href={`?tab=scripts&lang=${k}`} className={`chip ${lang === k ? 'bg-brand/20 text-brand' : 'bg-raised text-dim'}`}>{v} {n ? `· ${n}` : ''}</a>;
          })}</div>
          <p className="mb-4 text-sm text-dim">One approved script per language. The agent uses the borrower’s language and falls back to English if a script isn’t approved. {llmEnabled() ? 'Translate fills a draft from English for you to review.' : 'Add ANTHROPIC_API_KEY to translate automatically, or type the translation.'}</p>
          <div className="grid gap-4 lg:grid-cols-2">{TEMPLATE_KEYS.map((key) => {
            const t = templates.find((x) => x.key === key && x.language === lang);
            const en = templates.find((x) => x.key === key && x.language === 'en');
            return (
              <Card key={key} title={key.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())} actions={t ? <Badge v={t.approved ? 'COMPLETED' : 'BLOCKED'} label={t.approved ? 'Approved' : 'Draft'} /> : <Badge v="DUE" label="Not written" />}>
                {lang !== 'en' && en && <p className="mb-3 rounded-lg bg-raised p-3 text-xs text-mute">{en.body}</p>}
                <ActionForm action={act.templateAction} className="space-y-2">
                  <input type="hidden" name="key" value={key} /><input type="hidden" name="language" value={lang} />
                  <textarea name="body" rows={4} defaultValue={t?.body ?? ''} className="input" aria-label="Script" />
                  {w && <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-sm text-dim"><input type="checkbox" name="approve" defaultChecked={t?.approved} />Approved for use</label>
                    <button className="btn-primary">Save</button>{lang !== 'en' && <button name="translate" value="1" className="btn-ghost" formNoValidate>Translate from English</button>}</div>}
                </ActionForm>
              </Card>
            );
          })}</div>
        </>
      )}

      {tab === 'channels' && (
        <div className="grid gap-4 lg:grid-cols-2">
          {([
            ['VOICE', 'AI voice calls', 'Any outbound voice-agent provider (Indic voice). FinX sends the approved script; the provider calls back /api/webhooks/voice with the transcript and outcome.', 'VOICE_PROVIDER_URL, VOICE_PROVIDER_KEY'],
            ['WHATSAPP', 'WhatsApp Business', 'Meta WhatsApp Cloud API from your verified number. Point the webhook to /api/webhooks/whatsapp to read replies.', 'WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN'],
            ['SMS', 'SMS', 'Any HTTP SMS gateway (MSG91, Gupshup, Exotel). DLT-registered templates required in India. Fallback when WhatsApp fails.', 'SMS_WEBHOOK_URL, SMS_API_KEY'],
            ['EMAIL', 'Email from your mailbox', 'Statements and notices go out from your own Gmail or IMAP account, under your domain.', 'SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM'],
          ] as const).map(([k, t, d, env]) => (
            <Card key={k} title={t} actions={<Badge v={live[k] ? 'COMPLETED' : 'BLOCKED'} label={live[k] ? 'Connected' : 'Simulation mode'} />}>
              <p className="text-sm text-dim">{d}</p><p className="mt-3 text-xs text-mute">Set in the server environment: <code className="font-mono">{env}</code></p>
            </Card>
          ))}
          <Card title="FinX AI (chat and translation)" actions={<Badge v={llmEnabled() ? 'COMPLETED' : 'BLOCKED'} label={llmEnabled() ? 'Connected' : 'Not connected'} />}><p className="text-sm text-dim">Uses the Anthropic API. Set <code className="font-mono">ANTHROPIC_API_KEY</code>.</p></Card>
        </div>
      )}

      {tab === 'api' && (
        <Card title="API keys">
          <p className="mb-4 text-sm text-dim">The REST API at <code className="font-mono">/api/v1</code> reads borrowers, loans and dues and records payments. Send <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>. See the README for endpoints.</p>
          <ul className="mb-4 space-y-2 text-sm">{keys.map((k) => <li key={k.id} className="flex justify-between"><span>{k.name} <span className="font-mono text-xs text-mute">{k.prefix}…</span></span><span className="text-xs text-mute">{k.lastUsed ? `used ${k.lastUsed.toLocaleDateString('en-IN')}` : 'never used'}</span></li>)}</ul>
          {w && <ActionForm action={act.apiKeyAction} className="flex gap-2"><input name="name" className="input max-w-xs" placeholder="Key name, e.g. Payment gateway" required /><button className="btn-primary">Create key</button></ActionForm>}
        </Card>
      )}
    </>
  );
}
