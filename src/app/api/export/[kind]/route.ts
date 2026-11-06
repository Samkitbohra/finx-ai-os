import { NextResponse } from 'next/server';
import { getCtx } from '@/lib/auth';
import { listLoans, trialBalance, dayBook, profitAndLoss, balanceSheet } from '@/server/reports';
import { tallyXml, toCsv } from '@/server/accounting';
import { pledgeRegister } from '@/server/compliance';
import { fmtNo } from '@/server/core';
import { fromPaise, toPaise } from '@/lib/money';
import { addMonths, todayIST } from '@/lib/dates';

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: 'Sign in' }, { status: 401 });
  const u = new URL(req.url).searchParams;
  const to = u.get('to') ?? todayIST();
  const from = u.get('from') ?? `${addMonths(to, -1).slice(0, 8)}01`;
  const kind = (await params).kind;
  const file = (name: string, body: string, type = 'text/csv') => new NextResponse(body, { headers: { 'Content-Type': `${type}; charset=utf-8`, 'Content-Disposition': `attachment; filename="${name}"` } });

  switch (kind) {
    case 'loans': {
      const rows = await listLoans(ctx, { status: u.get('status') === 'all' ? undefined : u.get('status') ?? undefined, q: u.get('q') ?? undefined, limit: 10000 });
      return file(`loans-${todayIST()}.csv`, toCsv([['Loan', 'Borrower', 'Phone', 'Product', 'Branch', 'Status', 'Rate %', 'LTV %', 'Amount', 'Outstanding', 'DPD', 'Disbursed', 'Maturity'],
        ...rows.map((l) => [fmtNo.loan(l.loanNo), l.borrowerName, l.phone, l.product, l.branch, l.status, Number(l.rate), l.ltv ?? '', l.principal, l.outstanding, l.dpd, l.startDate ?? '', l.maturityDate ?? ''])]));
    }
    case 'trial-balance': {
      const tb = await trialBalance(ctx, to);
      return file(`trial-balance-${to}.csv`, toCsv([['Code', 'Account', 'Debit', 'Credit'], ...tb.rows.map((r) => [r.code, r.name, fromPaise(r.debit), fromPaise(r.credit)]), ['', 'Total', fromPaise(tb.totalDebit), fromPaise(tb.totalCredit)]]));
    }
    case 'pnl': {
      const p = await profitAndLoss(ctx, from, to);
      return file(`profit-and-loss-${from}-to-${to}.csv`, toCsv([['Section', 'Account', 'Amount'], ...p.income.map((r) => ['Income', r.name, fromPaise(r.balance)]), ['', 'Total income', fromPaise(p.totalIncome)], ...p.expense.map((r) => ['Expense', r.name, fromPaise(r.balance)]), ['', 'Total expenses', fromPaise(p.totalExpense)], ['', 'Net profit', fromPaise(p.net)]]));
    }
    case 'balance-sheet': {
      const b = await balanceSheet(ctx, to);
      return file(`balance-sheet-${to}.csv`, toCsv([['Side', 'Account', 'Amount'], ...b.assets.map((r) => ['Assets', r.name, fromPaise(r.balance)]), ['', 'Total assets', fromPaise(b.totalAssets)], ...b.liabilities.map((r) => ['Liabilities', r.name, fromPaise(r.balance)]), ...b.equity.map((r) => ['Equity', r.name, fromPaise(r.balance)]), ['Equity', 'Profit for the period', fromPaise(b.profit)], ['', 'Total liabilities and equity', fromPaise(b.totalLiabilitiesEquity)]]));
    }
    case 'daybook': {
      const d = await dayBook(ctx, from, to);
      return file(`daybook-${from}-to-${to}.csv`, toCsv([['Date', 'Voucher', 'Narration', 'Account', 'Debit', 'Credit'], ...d.flatMap((e) => e.lines.map((l) => [e.date, fmtNo.voucher(e.voucherNo), e.narration, l.account, l.debit, l.credit]))]));
    }
    case 'tally':
      return file(`finx-tally-${from}-to-${to}.xml`, await tallyXml(ctx, from, to), 'application/xml');
    case 'pledge-register': {
      const r = await pledgeRegister(ctx, from, to);
      return file(`pledge-register-${from}-to-${to}.csv`, toCsv([['S.No', 'Pledge date', 'Loan no.', 'Pledgor', 'Father/spouse', 'Address', 'Articles', 'Net wt (g)', 'Purity', 'Value', 'Amount lent', 'Rate %', 'Packet', 'Status', 'Redeemed on'],
        ...r.map((x, i) => { const d = x.details as Record<string, unknown>; return [i + 1, x.date, fmtNo.loan(x.loanNo), x.name, x.father ?? '', x.address ?? '', x.description, String(d.netWeight ?? ''), d.purityKarat ? `${d.purityKarat}K` : '', fromPaise(toPaise(x.value)), x.amount, Number(x.rate), x.packet ?? '', x.colStatus, x.closedAt ? x.closedAt.toISOString().slice(0, 10) : '']; })]));
    }
  }
  return NextResponse.json({ error: 'Unknown export' }, { status: 404 });
}
