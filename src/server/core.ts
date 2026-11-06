// Shared server helpers: running numbers, audit trail, ledger posting.
import { and, eq, sql } from 'drizzle-orm';
import { db, schema, Tx } from '@/db';
import type { Ctx } from '@/lib/auth';
import type { AssetType } from '@/db/schema';
import { fromPaise, Paise, toPaise } from '@/lib/money';
import { ISODate } from '@/lib/dates';

type Q = Tx | typeof db;

// ---------------------------------------------------------------- running numbers
export async function nextNo(q: Q, orgId: string, key: 'BORROWER' | 'LOAN' | 'RECEIPT' | 'INVOICE' | 'VOUCHER'): Promise<number> {
  const [row] = await q
    .insert(schema.counters)
    .values({ orgId, key, value: 1 })
    .onConflictDoUpdate({ target: [schema.counters.orgId, schema.counters.key], set: { value: sql`${schema.counters.value} + 1` } })
    .returning({ value: schema.counters.value });
  return row.value;
}

export const fmtNo = {
  borrower: (n: number) => `B-${String(n).padStart(4, '0')}`,
  loan: (n: number) => String(n).padStart(4, '0'),
  receipt: (n: number) => `R-${String(n).padStart(5, '0')}`,
  invoice: (n: number) => `INV-${String(n).padStart(5, '0')}`,
  voucher: (n: number) => `JV-${String(n).padStart(5, '0')}`,
};

// ---------------------------------------------------------------- audit
export async function audit(
  q: Q,
  ctx: Ctx,
  a: { action: string; entity: string; entityId?: string | null; before?: unknown; after?: unknown; summary?: string },
) {
  await q.insert(schema.auditLogs).values({
    orgId: ctx.orgId, userId: ctx.userId, via: ctx.via, action: a.action, entity: a.entity, entityId: a.entityId ?? null,
    before: (a.before ?? null) as object | null, after: (a.after ?? null) as object | null, summary: a.summary,
  });
}

// ---------------------------------------------------------------- chart of accounts
export const CHART: { code: string; name: string; type: (typeof schema.accountTypeEnum.enumValues)[number]; key?: string }[] = [
  { code: '1000', name: 'Cash in hand', type: 'ASSET', key: 'CASH' },
  { code: '1010', name: 'Bank — current account', type: 'ASSET', key: 'BANK' },
  { code: '1100', name: 'Loans — gold & jewel', type: 'ASSET', key: 'LOANS_GOLD' },
  { code: '1110', name: 'Loans — vehicle', type: 'ASSET', key: 'LOANS_VEHICLE' },
  { code: '1120', name: 'Loans — property', type: 'ASSET', key: 'LOANS_PROPERTY' },
  { code: '1130', name: 'Loans — machinery', type: 'ASSET', key: 'LOANS_MACHINERY' },
  { code: '1140', name: 'Loans — business', type: 'ASSET', key: 'LOANS_BUSINESS' },
  { code: '1150', name: 'Loans — unsecured', type: 'ASSET', key: 'LOANS_UNSECURED' },
  { code: '1300', name: 'GST input credit', type: 'ASSET', key: 'GST_INPUT' },
  { code: '1400', name: 'TDS receivable', type: 'ASSET', key: 'TDS_RECEIVABLE' },
  { code: '2000', name: 'GST output payable', type: 'LIABILITY', key: 'GST_OUTPUT' },
  { code: '2100', name: 'TDS payable', type: 'LIABILITY', key: 'TDS_PAYABLE' },
  { code: '2200', name: 'Payable to borrowers (auction surplus)', type: 'LIABILITY', key: 'BORROWER_PAYABLE' },
  { code: '2300', name: 'Unapplied receipts', type: 'LIABILITY', key: 'UNAPPLIED' },
  { code: '2400', name: 'Borrowings', type: 'LIABILITY', key: 'BORROWINGS' },
  { code: '2500', name: 'Sundry creditors', type: 'LIABILITY', key: 'CREDITORS' },
  { code: '3000', name: "Owner's capital", type: 'EQUITY', key: 'CAPITAL' },
  { code: '3100', name: 'Retained earnings', type: 'EQUITY', key: 'RETAINED' },
  { code: '4000', name: 'Interest income', type: 'INCOME', key: 'INTEREST_INCOME' },
  { code: '4010', name: 'Penal interest income', type: 'INCOME', key: 'PENAL_INCOME' },
  { code: '4100', name: 'Processing charges', type: 'INCOME', key: 'FEE_INCOME' },
  { code: '4200', name: 'Other income', type: 'INCOME', key: 'OTHER_INCOME' },
  { code: '5000', name: 'Salaries', type: 'EXPENSE', key: 'SALARIES' },
  { code: '5100', name: 'Rent', type: 'EXPENSE', key: 'RENT' },
  { code: '5200', name: 'Calls, SMS & messaging', type: 'EXPENSE', key: 'COMMS' },
  { code: '5300', name: 'Bad debts written off', type: 'EXPENSE', key: 'BAD_DEBTS' },
  { code: '5400', name: 'Loss on auction', type: 'EXPENSE', key: 'AUCTION_LOSS' },
  { code: '5500', name: 'Interest on borrowings', type: 'EXPENSE', key: 'INTEREST_EXPENSE' },
  { code: '5900', name: 'Other expenses', type: 'EXPENSE', key: 'OTHER_EXPENSE' },
];

export const loanAccountKey = (t: AssetType) => `LOANS_${t}`;
export const cashKey = (mode: string) => (mode === 'CASH' ? 'CASH' : 'BANK');

export async function ensureChart(q: Q, orgId: string) {
  await q.insert(schema.accounts).values(CHART.map((c) => ({ orgId, code: c.code, name: c.name, type: c.type, systemKey: c.key ?? null }))).onConflictDoNothing();
}

async function accountIds(q: Q, orgId: string): Promise<Map<string, string>> {
  const rows = await q.select({ id: schema.accounts.id, key: schema.accounts.systemKey, code: schema.accounts.code }).from(schema.accounts).where(eq(schema.accounts.orgId, orgId));
  const m = new Map<string, string>();
  for (const r of rows) { if (r.key) m.set(r.key, r.id); m.set(`#${r.code}`, r.id); m.set(r.id, r.id); }
  return m;
}

export interface Line { account: string; debit?: Paise; credit?: Paise; loanId?: string | null; memo?: string } // account = systemKey, '#code' or id

/** Post a balanced journal entry. Throws if debits ≠ credits. Zero lines are dropped. */
export async function post(
  q: Q,
  ctx: Ctx,
  e: { date: ISODate; narration: string; sourceType: string; sourceId?: string | null; branchId?: string | null; lines: Line[]; reversalOfId?: string },
) {
  const lines = e.lines.filter((l) => (l.debit ?? 0) !== 0 || (l.credit ?? 0) !== 0);
  const dr = lines.reduce((a, l) => a + (l.debit ?? 0), 0);
  const cr = lines.reduce((a, l) => a + (l.credit ?? 0), 0);
  if (dr !== cr) throw new Error(`Unbalanced entry "${e.narration}": Dr ${dr} ≠ Cr ${cr}`);
  if (!lines.length) return null;
  const ids = await accountIds(q, ctx.orgId);
  const voucherNo = await nextNo(q, ctx.orgId, 'VOUCHER');
  const [entry] = await q.insert(schema.journalEntries).values({
    orgId: ctx.orgId, branchId: e.branchId ?? null, voucherNo, date: e.date, narration: e.narration, sourceType: e.sourceType,
    sourceId: e.sourceId ?? null, createdById: ctx.userId, reversalOfId: e.reversalOfId ?? null,
  }).returning();
  await q.insert(schema.journalLines).values(lines.map((l) => {
    const accountId = ids.get(l.account);
    if (!accountId) throw new Error(`Unknown account ${l.account}`);
    return { entryId: entry.id, accountId, debit: fromPaise(l.debit ?? 0), credit: fromPaise(l.credit ?? 0), loanId: l.loanId ?? null, memo: l.memo };
  }));
  return entry;
}

/** Post the mirror image of an entry. */
export async function reverseEntry(q: Q, ctx: Ctx, entryId: string, date: ISODate, reason: string) {
  const entry = await q.query.journalEntries.findFirst({ where: and(eq(schema.journalEntries.id, entryId), eq(schema.journalEntries.orgId, ctx.orgId)), with: undefined });
  if (!entry) throw new Error('Entry not found');
  const lines = await q.select().from(schema.journalLines).where(eq(schema.journalLines.entryId, entryId));
  return post(q, ctx, {
    date, narration: `Reversal of JV-${entry.voucherNo}: ${reason}`, sourceType: 'REVERSAL', sourceId: entry.sourceId, branchId: entry.branchId,
    reversalOfId: entry.id,
    lines: lines.map((l) => ({ account: l.accountId, debit: toPaise(l.credit), credit: toPaise(l.debit), loanId: l.loanId, memo: l.memo ?? undefined })),
  });
}

export function scopeBranch<T>(ctx: Ctx, col: T) {
  return ctx.branchId ? eq(col as never, ctx.branchId) : undefined;
}
