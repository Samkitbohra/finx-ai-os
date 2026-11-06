import { asc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireCtx } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { dayBook, trialBalance, profitAndLoss, balanceSheet, accountLedger, gstSummary } from '@/server/reports';
import { PageHeader, Card, Tabs, Badge } from '@/components/ui';
import { ActionForm, Field } from '@/components/form';
import { fmtNo } from '@/server/core';
import { fmtP, toPaise } from '@/lib/money';
import { addMonths, fmtDate, todayIST } from '@/lib/dates';
import { journalAction, reissueInvoiceAction } from '../actions';

export const metadata = { title: 'Accounting' };
const P = ({ p, strong }: { p: number; strong?: boolean }) => <span className={`num ${strong ? 'font-semibold' : ''} ${p < 0 ? 'text-bad' : ''}`}>{p === 0 ? '—' : fmtP(p)}</span>;

export default async function Accounting({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const tab = sp.tab ?? 'daybook';
  const to = sp.to ?? todayIST();
  const from = sp.from ?? (tab === 'daybook' ? to : `${to.slice(0, 7)}-01`);
  const accounts = await db.select().from(schema.accounts).where(eq(schema.accounts.orgId, ctx.orgId)).orderBy(asc(schema.accounts.code));
  const qs = (o: Record<string, string>) => '?' + new URLSearchParams({ ...(sp as Record<string, string>), ...o }).toString();
  const exp = (k: string) => `/api/export/${k}?from=${from}&to=${to}`;

  const range = (
    <form className="mb-4 flex flex-wrap items-end gap-2">
      <input type="hidden" name="tab" value={tab} />
      {tab === 'ledger' && <div><label className="label" htmlFor="account">Account</label><select id="account" name="account" defaultValue={sp.account ?? accounts[0]?.id} className="input">{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></div>}
      {tab === 'gst' ? <div><label className="label" htmlFor="month">Month</label><input id="month" type="month" name="month" defaultValue={sp.month ?? to.slice(0, 7)} className="input" /></div> : <>
        {!['tb', 'bs'].includes(tab) && <div><label className="label" htmlFor="from">From</label><input id="from" type="date" name="from" defaultValue={from} className="input" /></div>}
        <div><label className="label" htmlFor="to">{['tb', 'bs'].includes(tab) ? 'As of' : 'To'}</label><input id="to" type="date" name="to" defaultValue={to} className="input" /></div>
      </>}
      <button className="btn-ghost">Show</button>
    </form>
  );

  return (
    <>
      <PageHeader title="Accounting" sub="The loan book and the accounts are one system: every disbursal, receipt and fee posts a double entry as it happens."
        actions={<><a className="btn-ghost" href={exp('tally')}>Export to Tally (XML)</a></>} />
      <Tabs active={tab} items={[
        { key: 'daybook', label: 'Day book', href: qs({ tab: 'daybook' }) }, { key: 'tb', label: 'Trial balance', href: qs({ tab: 'tb' }) },
        { key: 'pnl', label: 'Profit & loss', href: qs({ tab: 'pnl' }) }, { key: 'bs', label: 'Balance sheet', href: qs({ tab: 'bs' }) },
        { key: 'ledger', label: 'Ledgers', href: qs({ tab: 'ledger' }) }, { key: 'gst', label: 'GST & invoices', href: qs({ tab: 'gst' }) },
        ...(can(ctx.role, 'journal.write') ? [{ key: 'journal', label: 'Journal entry', href: qs({ tab: 'journal' }) }] : []),
      ]} />
      {tab !== 'journal' && range}

      {tab === 'daybook' && (async () => {
        const d = await dayBook(ctx, from, to);
        const dr = d.reduce((a, e) => a + e.lines.reduce((x, l) => x + toPaise(l.debit), 0), 0);
        const cr = d.reduce((a, e) => a + e.lines.reduce((x, l) => x + toPaise(l.credit), 0), 0);
        return (
          <Card title={`Day book · ${fmtDate(from)}${from !== to ? ` – ${fmtDate(to)}` : ''}`} actions={<span className="flex items-center gap-3"><Badge v={dr === cr ? 'COMPLETED' : 'FAILED'} label={dr === cr ? 'Balanced' : 'Out of balance'} /><a className="text-xs text-brand" href={exp('daybook')}>CSV</a></span>} pad={false}>
            {d.length === 0 ? <p className="p-5 text-sm text-dim">No entries in this period. Try a wider range.</p> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[760px]">
                <thead><tr><th className="th">Voucher</th><th className="th">Account</th><th className="th">Source</th><th className="th text-right">Debit</th><th className="th text-right">Credit</th></tr></thead>
                <tbody>{d.map((e) => e.lines.map((l, i) => (
                  <tr key={`${e.id}${i}`} className={i === 0 ? 'border-t border-line' : ''}>
                    <td className="td py-2 align-top text-xs text-mute">{i === 0 ? <><div className="num text-dim">{fmtNo.voucher(e.voucherNo)} · {fmtDate(e.date)}</div><div>{e.narration}</div></> : null}</td>
                    <td className="td py-2">{l.account}</td>
                    <td className="td py-2 text-xs text-mute">{i === 0 ? e.sourceType.toLowerCase().replace('_', ' ') : ''}</td>
                    <td className="td py-2 text-right"><P p={toPaise(l.debit)} /></td>
                    <td className="td py-2 text-right"><P p={toPaise(l.credit)} /></td>
                  </tr>
                )))}</tbody>
                <tfoot><tr className="border-t-2 border-line"><td className="td font-semibold" colSpan={3}>{d.length} vouchers</td><td className="td text-right"><P p={dr} strong /></td><td className="td text-right"><P p={cr} strong /></td></tr></tfoot>
              </table></div>
            )}
          </Card>
        );
      })()}

      {tab === 'tb' && (async () => {
        const tb = await trialBalance(ctx, to);
        return (
          <Card title={`Trial balance as of ${fmtDate(to)}`} actions={<span className="flex items-center gap-3"><Badge v={tb.totalDebit === tb.totalCredit ? 'COMPLETED' : 'FAILED'} label={tb.totalDebit === tb.totalCredit ? 'Ties out' : 'Does not tie out'} /><a className="text-xs text-brand" href={exp('trial-balance')}>CSV</a></span>} pad={false}>
            <table className="w-full"><thead><tr><th className="th">Code</th><th className="th">Account</th><th className="th text-right">Debit</th><th className="th text-right">Credit</th></tr></thead>
              <tbody>{tb.rows.map((r) => <tr key={r.id} className="tr"><td className="td num text-mute">{r.code}</td><td className="td"><a className="hover:text-brand" href={qs({ tab: 'ledger', account: r.id })}>{r.name}</a></td><td className="td text-right"><P p={r.debit} /></td><td className="td text-right"><P p={r.credit} /></td></tr>)}</tbody>
              <tfoot><tr className="border-t-2 border-line"><td className="td" /><td className="td font-semibold">Total</td><td className="td text-right"><P p={tb.totalDebit} strong /></td><td className="td text-right"><P p={tb.totalCredit} strong /></td></tr></tfoot>
            </table>
          </Card>
        );
      })()}

      {tab === 'pnl' && (async () => {
        const p = await profitAndLoss(ctx, from, to);
        const Section = ({ title, rows, total }: { title: string; rows: typeof p.income; total: number }) => (<>
          <tr><td className="td pt-5 text-xs font-semibold uppercase tracking-wider text-mute" colSpan={2}>{title}</td></tr>
          {rows.map((r) => <tr key={r.id} className="tr"><td className="td">{r.name}</td><td className="td text-right"><P p={r.balance} /></td></tr>)}
          <tr className="border-t border-line"><td className="td font-semibold">Total {title.toLowerCase()}</td><td className="td text-right"><P p={total} strong /></td></tr>
        </>);
        return (
          <Card title={`Profit and loss · ${fmtDate(from)} – ${fmtDate(to)}`} actions={<a className="text-xs text-brand" href={exp('pnl')}>CSV</a>} pad={false}>
            <table className="w-full"><tbody>
              <Section title="Income" rows={p.income} total={p.totalIncome} />
              <Section title="Expenses" rows={p.expense} total={p.totalExpense} />
              <tr className="border-t-2 border-line"><td className="td text-base font-semibold">Net profit</td><td className="td text-right text-base"><P p={p.net} strong /></td></tr>
            </tbody></table>
          </Card>
        );
      })()}

      {tab === 'bs' && (async () => {
        const b = await balanceSheet(ctx, to);
        return (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Assets" pad={false} actions={<a className="text-xs text-brand" href={exp('balance-sheet')}>CSV</a>}><table className="w-full"><tbody>
              {b.assets.map((r) => <tr key={r.id} className="tr"><td className="td">{r.name}</td><td className="td text-right"><P p={r.balance} /></td></tr>)}
              <tr className="border-t-2 border-line"><td className="td font-semibold">Total assets</td><td className="td text-right"><P p={b.totalAssets} strong /></td></tr>
            </tbody></table></Card>
            <Card title="Liabilities and equity" pad={false} actions={<Badge v={b.totalAssets === b.totalLiabilitiesEquity ? 'COMPLETED' : 'FAILED'} label={b.totalAssets === b.totalLiabilitiesEquity ? 'Balanced' : 'Not balanced'} />}><table className="w-full"><tbody>
              {[...b.liabilities, ...b.equity].map((r) => <tr key={r.id} className="tr"><td className="td">{r.name}</td><td className="td text-right"><P p={r.balance} /></td></tr>)}
              <tr className="tr"><td className="td">Profit to date</td><td className="td text-right"><P p={b.profit} /></td></tr>
              <tr className="border-t-2 border-line"><td className="td font-semibold">Total</td><td className="td text-right"><P p={b.totalLiabilitiesEquity} strong /></td></tr>
            </tbody></table></Card>
          </div>
        );
      })()}

      {tab === 'ledger' && (async () => {
        const l = await accountLedger(ctx, sp.account ?? accounts[0].id, from, to);
        if (!l) return null;
        return (
          <Card title={`${l.account.code} · ${l.account.name}`} pad={false} actions={<span className="text-xs text-mute">Opening <P p={l.opening} /> · Closing <P p={l.closing} strong /></span>}>
            <div className="overflow-x-auto"><table className="w-full min-w-[700px]"><thead><tr><th className="th">Date</th><th className="th">Voucher</th><th className="th">Narration</th><th className="th text-right">Debit</th><th className="th text-right">Credit</th><th className="th text-right">Balance</th></tr></thead>
              <tbody>{l.lines.map((x, i) => <tr key={i} className="tr"><td className="td num text-dim">{fmtDate(x.date)}</td><td className="td num text-mute">{fmtNo.voucher(x.voucherNo)}</td><td className="td text-sm text-dim">{x.narration}</td><td className="td text-right"><P p={x.dr} /></td><td className="td text-right"><P p={x.cr} /></td><td className="td text-right"><P p={x.balance} /></td></tr>)}</tbody></table></div>
          </Card>
        );
      })()}

      {tab === 'gst' && (async () => {
        const g = await gstSummary(ctx, sp.month ?? to.slice(0, 7));
        return (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="card p-4"><div className="label">Taxable charges</div><div className="num mt-1 text-xl font-semibold">{fmtP(g.taxable)}</div></div>
              <div className="card p-4"><div className="label">GST payable (output)</div><div className="num mt-1 text-xl font-semibold">{fmtP(g.gst)}</div></div>
              <div className="card p-4"><div className="label">Interest (exempt supply)</div><div className="num mt-1 text-xl font-semibold">{fmtP(g.exemptInterest)}</div></div>
            </div>
            <Card title="Invoices" pad={false} actions={can(ctx.role, 'invoice.write') ? (
              <ActionForm action={reissueInvoiceAction} className="flex items-end gap-2"><input name="invoiceNo" className="input h-9 w-28" placeholder="Invoice no." required /><input name="gstRate" className="input h-9 w-24" placeholder="GST %" defaultValue="18" required /><button className="btn-ghost h-9">Re-issue at this GST</button></ActionForm>) : null}>
              <div className="overflow-x-auto"><table className="w-full min-w-[700px]"><thead><tr><th className="th">Invoice</th><th className="th">Date</th><th className="th">Description</th><th className="th text-right">Taxable</th><th className="th text-right">GST</th><th className="th text-right">Total</th><th className="th">Status</th></tr></thead>
                <tbody>{g.invoices.map((i) => <tr key={i.id} className="tr"><td className="td num">{fmtNo.invoice(i.invoiceNo)}</td><td className="td num text-dim">{i.issuedAt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}</td><td className="td text-sm text-dim">{i.description}</td><td className="td text-right"><P p={toPaise(i.amount)} /></td><td className="td text-right text-dim">{Number(i.gstRate)}% · <P p={toPaise(i.gstAmount)} /></td><td className="td text-right"><P p={toPaise(i.total)} /></td><td className="td"><Badge v={i.status} /></td></tr>)}</tbody></table></div>
            </Card>
          </div>
        );
      })()}

      {tab === 'journal' && can(ctx.role, 'journal.write') && (
        <Card title="Journal entry" actions={<span className="text-xs text-mute">Expenses, transfers and adjustments. Loan movements post themselves.</span>}>
          <ActionForm action={journalAction} className="space-y-4" submit="Post entry" reset>
            <div className="grid gap-3 sm:grid-cols-3"><Field label="Date" name="date" type="date" defaultValue={todayIST()} required /><Field label="Narration" name="narration" required className="sm:col-span-2" /></div>
            <div className="space-y-2">{[0, 1, 2, 3].map((i) => (
              <div key={i} className="grid grid-cols-[1fr_140px_140px] gap-2">
                <select name={`acc${i}`} className="input" aria-label={`Account ${i + 1}`}><option value="">{i < 2 ? 'Choose account' : '(optional)'}</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select>
                <input name={`dr${i}`} type="number" step="0.01" className="input" placeholder="Debit" aria-label="Debit" /><input name={`cr${i}`} type="number" step="0.01" className="input" placeholder="Credit" aria-label="Credit" />
              </div>
            ))}</div>
            <div className="max-w-xs"><Field label="Deduct TDS (%) on the expense" name="tdsPct" type="number" step="0.1" hint="e.g. 10% on rent (194-I), 1–2% on contractors (194C)" /></div>
          </ActionForm>
        </Card>
      )}
      <p className="mt-4 text-xs text-mute">Showing {fmtDate(from)} to {fmtDate(to)}. Previous month: <a className="text-brand" href={qs({ from: `${addMonths(to, -1).slice(0, 7)}-01`, to: `${to.slice(0, 7)}-01` })}>open</a>.</p>
    </>
  );
}
