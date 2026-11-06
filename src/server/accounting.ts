// Manual journals (expenses with TDS, transfers) and exports for the auditor (Tally XML, CSV).
import { z } from 'zod';
import { db } from '@/db';
import type { Ctx } from '@/lib/auth';
import { assertCan } from '@/lib/auth';
import { UserError } from '@/lib/permissions';
import { toPaise, fromPaise } from '@/lib/money';
import { audit, post } from './core';
import { dayBook } from './reports';
import { ISODate } from '@/lib/dates';

const journalInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  narration: z.string().min(3, 'Add a narration'),
  lines: z.array(z.object({ account: z.string(), debit: z.number().optional(), credit: z.number().optional() })).min(2, 'At least two lines'),
  tdsPct: z.number().min(0).max(30).optional(),
});

/**
 * Post a manual journal. With `tdsPct`, the first debit line is treated as an expense paid to a vendor:
 * TDS is deducted from the credit to the bank/cash line and credited to TDS payable.
 */
export async function manualJournal(ctx: Ctx, raw: z.input<typeof journalInput>) {
  assertCan(ctx, 'journal.write');
  const d = journalInput.parse(raw);
  const lines = d.lines.map((l) => ({ account: l.account, debit: toPaise(l.debit ?? 0), credit: toPaise(l.credit ?? 0) }));
  if (d.tdsPct) {
    const exp = lines.find((l) => l.debit > 0);
    const pay = lines.find((l) => l.credit > 0);
    if (!exp || !pay) throw new UserError('TDS needs one expense (debit) and one payment (credit) line');
    const tds = Math.round((exp.debit * d.tdsPct) / 100);
    pay.credit -= tds;
    lines.push({ account: 'TDS_PAYABLE', debit: 0, credit: tds });
  }
  const dr = lines.reduce((a, l) => a + l.debit, 0), cr = lines.reduce((a, l) => a + l.credit, 0);
  if (dr !== cr) throw new UserError(`Debits (₹${dr / 100}) and credits (₹${cr / 100}) must match`);
  return db.transaction(async (tx) => {
    const e = await post(tx, ctx, { date: d.date, narration: d.narration, sourceType: 'MANUAL', branchId: ctx.branchId, lines });
    await audit(tx, ctx, { action: 'journal', entity: 'journal', entityId: e?.id, summary: `Manual journal: ${d.narration}` });
    return e;
  });
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Tally Prime import file (XML) for vouchers in a date range. Ledger names match the FinX chart of accounts. */
export async function tallyXml(ctx: Ctx, from: ISODate, to: ISODate) {
  const entries = await dayBook(ctx, from, to);
  const vt = (s: string) => (s === 'RECEIPT' ? 'Receipt' : s === 'DISBURSAL' || s === 'EXPENSE' ? 'Payment' : 'Journal');
  const vouchers = entries.map((e) => `
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER VCHTYPE="${vt(e.sourceType)}" ACTION="Create">
          <DATE>${e.date.replace(/-/g, '')}</DATE>
          <VOUCHERTYPENAME>${vt(e.sourceType)}</VOUCHERTYPENAME>
          <VOUCHERNUMBER>JV-${e.voucherNo}</VOUCHERNUMBER>
          <NARRATION>${esc(e.narration)}</NARRATION>${e.lines.map((l) => {
            const dr = toPaise(l.debit) > 0;
            const amt = dr ? toPaise(l.debit) : toPaise(l.credit);
            return `
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${esc(l.account)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>${dr ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
            <AMOUNT>${dr ? '-' : ''}${fromPaise(amt)}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`;
          }).join('')}
        </VOUCHER>
      </TALLYMESSAGE>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC><REQUESTDATA>${vouchers}
  </REQUESTDATA></IMPORTDATA></BODY>
</ENVELOPE>`;
}

export function toCsv(rows: (string | number | null | undefined)[][]) {
  return rows.map((r) => r.map((c) => { const s = c == null ? '' : String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
}
