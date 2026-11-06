// Read models for the console: portfolio, ageing, collections, and accounting statements.
import { and, asc, desc, eq, gte, inArray, lte, sql, ilike, or } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { Ctx } from '@/lib/auth';
import { toPaise } from '@/lib/money';
import { addDays, addMonths, ISODate, monthKey, todayIST } from '@/lib/dates';

const T = schema;
const branchCond = (ctx: Ctx, col: typeof T.loans.branchId | typeof T.borrowers.branchId, branchId?: string | null) => {
  const b = ctx.branchId ?? branchId ?? null;
  return b ? eq(col, b) : undefined;
};

export async function portfolio(ctx: Ctx, opts: { branchId?: string | null; months?: number } = {}) {
  const today = todayIST();
  const months = opts.months ?? 6;
  const bc = branchCond(ctx, T.loans.branchId, opts.branchId);
  const active = await db.select({
    id: T.loans.id, out: T.loans.outstandingPrincipal, rate: T.loans.annualRate, dpd: T.loans.dpd, frequency: T.loans.frequency,
    maturity: T.loans.maturityDate, productId: T.loans.productId,
  }).from(T.loans).where(and(eq(T.loans.orgId, ctx.orgId), eq(T.loans.status, 'ACTIVE'), bc));

  const aum = active.reduce((a, l) => a + toPaise(l.out), 0);
  const weighted = active.reduce((a, l) => a + toPaise(l.out) * Number(l.rate), 0);
  const npa = active.filter((l) => l.dpd > 90).reduce((a, l) => a + toPaise(l.out), 0);
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
  const counts = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
  for (const l of active) {
    const k = l.dpd === 0 ? 'current' : l.dpd <= 30 ? 'd1_30' : l.dpd <= 60 ? 'd31_60' : l.dpd <= 90 ? 'd61_90' : 'd90p';
    buckets[k] += toPaise(l.out); counts[k]++;
  }
  const dueBack = active.filter((l) => l.frequency === 'BULLET' && l.maturity && l.maturity >= today && l.maturity <= addDays(today, 7)).length;

  // disbursed vs collected by month
  const start = `${monthKey(addMonths(today, -(months - 1)))}-01`;
  const disb = await db.select({ m: sql<string>`to_char(${T.disbursements.at} at time zone 'Asia/Kolkata', 'YYYY-MM')`, amt: sql<string>`sum(${T.loans.principal})` })
    .from(T.disbursements).innerJoin(T.loans, eq(T.loans.id, T.disbursements.loanId))
    .where(and(eq(T.loans.orgId, ctx.orgId), bc, gte(T.disbursements.at, new Date(`${start}T00:00:00+05:30`)))).groupBy(sql`1`);
  const coll = await db.select({ m: sql<string>`to_char(${T.payments.receivedAt} at time zone 'Asia/Kolkata', 'YYYY-MM')`, amt: sql<string>`sum(${T.payments.amount})` })
    .from(T.payments).innerJoin(T.loans, eq(T.loans.id, T.payments.loanId))
    .where(and(eq(T.payments.orgId, ctx.orgId), eq(T.payments.reversed, false), bc, gte(T.payments.receivedAt, new Date(`${start}T00:00:00+05:30`)))).groupBy(sql`1`);
  const series = Array.from({ length: months }, (_, i) => {
    const m = monthKey(addMonths(today, i - (months - 1)));
    return { month: m, disbursed: toPaise(disb.find((d) => d.m === m)?.amt ?? 0), collected: toPaise(coll.find((c) => c.m === m)?.amt ?? 0) };
  });
  const thisMonth = series[series.length - 1];
  const lastMonth = series[series.length - 2];

  const pending = await db.select({ n: sql<number>`count(*)::int` }).from(T.loans).where(and(eq(T.loans.orgId, ctx.orgId), eq(T.loans.status, 'PENDING_APPROVAL'), bc));
  const approved = await db.select({ n: sql<number>`count(*)::int` }).from(T.loans).where(and(eq(T.loans.orgId, ctx.orgId), eq(T.loans.status, 'APPROVED'), bc));

  return {
    aum, loans: active.length, yieldPct: aum ? weighted / aum : 0, npaPct: aum ? (npa / aum) * 100 : 0, npa,
    collectedMtd: thisMonth.collected, collectedLastMonth: lastMonth?.collected ?? 0, disbursedMtd: thisMonth.disbursed,
    buckets, counts, dueBack, series, pendingApprovals: pending[0].n, awaitingDisbursal: approved[0].n,
  };
}

export async function listLoans(ctx: Ctx, f: { status?: string; q?: string; dpdMin?: number; branchId?: string; limit?: number; assetType?: string } = {}) {
  const conds = [eq(T.loans.orgId, ctx.orgId), branchCond(ctx, T.loans.branchId, f.branchId)];
  if (f.status) conds.push(eq(T.loans.status, f.status as never));
  if (f.dpdMin != null) conds.push(gte(T.loans.dpd, f.dpdMin));
  if (f.assetType) conds.push(eq(T.products.assetType, f.assetType as never));
  if (f.q) {
    const n = Number(f.q.replace(/\D/g, ''));
    conds.push(or(ilike(T.borrowers.name, `%${f.q}%`), ilike(T.borrowers.phone, `%${f.q}%`), n ? eq(T.loans.loanNo, n) : undefined));
  }
  return db.select({
    id: T.loans.id, loanNo: T.loans.loanNo, status: T.loans.status, principal: T.loans.principal, outstanding: T.loans.outstandingPrincipal,
    rate: T.loans.annualRate, dpd: T.loans.dpd, ltv: T.loans.ltvAtSanction, startDate: T.loans.startDate, maturityDate: T.loans.maturityDate,
    borrowerId: T.borrowers.id, borrowerName: T.borrowers.name, phone: T.borrowers.phone, product: T.products.name, assetType: T.products.assetType,
    method: T.loans.interestMethod, branch: T.branches.name,
  }).from(T.loans)
    .innerJoin(T.borrowers, eq(T.borrowers.id, T.loans.borrowerId))
    .innerJoin(T.products, eq(T.products.id, T.loans.productId))
    .innerJoin(T.branches, eq(T.branches.id, T.loans.branchId))
    .where(and(...conds)).orderBy(desc(T.loans.dpd), desc(T.loans.loanNo)).limit(f.limit ?? 200);
}

export async function listBorrowers(ctx: Ctx, f: { q?: string; limit?: number } = {}) {
  const conds = [eq(T.borrowers.orgId, ctx.orgId), branchCond(ctx, T.borrowers.branchId)];
  if (f.q) conds.push(or(ilike(T.borrowers.name, `%${f.q}%`), ilike(T.borrowers.phone, `%${f.q}%`), ilike(T.borrowers.pan, `%${f.q}%`)));
  return db.select({
    id: T.borrowers.id, code: T.borrowers.code, name: T.borrowers.name, phone: T.borrowers.phone, city: T.borrowers.city, kyc: T.borrowers.kycStatus,
    score: T.borrowers.repaymentScore, language: T.borrowers.language,
    loans: sql<number>`(select count(*)::int from ${T.loans} where ${T.loans.borrowerId} = ${T.borrowers.id} and ${T.loans.status} = 'ACTIVE')`,
    outstanding: sql<string>`(select coalesce(sum(${T.loans.outstandingPrincipal}),0) from ${T.loans} where ${T.loans.borrowerId} = ${T.borrowers.id} and ${T.loans.status} = 'ACTIVE')`,
  }).from(T.borrowers).where(and(...conds)).orderBy(desc(T.borrowers.code)).limit(f.limit ?? 200);
}

export async function loanDetail(ctx: Ctx, loanId: string) {
  const loan = await db.query.loans.findFirst({ where: and(eq(T.loans.id, loanId), eq(T.loans.orgId, ctx.orgId)) });
  if (!loan) return null;
  const [borrower, product, branch, inst, pays, cols, guars, invs, comms, docs, disb] = await Promise.all([
    db.query.borrowers.findFirst({ where: eq(T.borrowers.id, loan.borrowerId) }),
    db.query.products.findFirst({ where: eq(T.products.id, loan.productId) }),
    db.query.branches.findFirst({ where: eq(T.branches.id, loan.branchId) }),
    db.select().from(T.installments).where(eq(T.installments.loanId, loanId)).orderBy(asc(T.installments.seq)),
    db.select().from(T.payments).where(eq(T.payments.loanId, loanId)).orderBy(desc(T.payments.receivedAt)),
    db.select().from(T.collaterals).where(eq(T.collaterals.loanId, loanId)),
    db.select().from(T.guarantors).where(eq(T.guarantors.loanId, loanId)),
    db.select().from(T.invoices).where(eq(T.invoices.loanId, loanId)).orderBy(desc(T.invoices.invoiceNo)),
    db.select().from(T.communications).where(eq(T.communications.loanId, loanId)).orderBy(desc(T.communications.createdAt)).limit(50),
    db.select().from(T.documents).where(and(eq(T.documents.ownerType, 'LOAN'), eq(T.documents.ownerId, loanId))).orderBy(desc(T.documents.createdAt)),
    db.select().from(T.disbursements).where(eq(T.disbursements.loanId, loanId)),
  ]);
  const officer = loan.officerId ? await db.query.users.findFirst({ where: eq(T.users.id, loan.officerId), columns: { name: true } }) : null;
  const approver = loan.approvedById ? await db.query.users.findFirst({ where: eq(T.users.id, loan.approvedById), columns: { name: true } }) : null;
  const history = await db.select().from(T.auditLogs).where(and(eq(T.auditLogs.entity, 'loan'), eq(T.auditLogs.entityId, loanId))).orderBy(desc(T.auditLogs.at)).limit(50);
  return { loan, borrower: borrower!, product: product!, branch: branch!, installments: inst, payments: pays, collaterals: cols, guarantors: guars, invoices: invs, communications: comms, documents: docs, disbursements: disb, officer, approver, history };
}

// ---------------------------------------------------------------- accounting
export async function balances(ctx: Ctx, opts: { to?: ISODate; from?: ISODate; branchId?: string | null } = {}) {
  const conds = [eq(T.journalEntries.orgId, ctx.orgId)];
  if (opts.to) conds.push(lte(T.journalEntries.date, opts.to));
  if (opts.from) conds.push(gte(T.journalEntries.date, opts.from));
  if (opts.branchId) conds.push(eq(T.journalEntries.branchId, opts.branchId));
  const rows = await db.select({
    id: T.accounts.id, code: T.accounts.code, name: T.accounts.name, type: T.accounts.type,
    dr: sql<string>`coalesce(sum(${T.journalLines.debit}),0)`, cr: sql<string>`coalesce(sum(${T.journalLines.credit}),0)`,
  }).from(T.accounts)
    .leftJoin(T.journalLines, eq(T.journalLines.accountId, T.accounts.id))
    .leftJoin(T.journalEntries, and(eq(T.journalEntries.id, T.journalLines.entryId), ...conds))
    .where(and(eq(T.accounts.orgId, ctx.orgId), or(sql`${T.journalEntries.id} is not null`, sql`${T.journalLines.id} is null`)))
    .groupBy(T.accounts.id).orderBy(asc(T.accounts.code));
  return rows.map((r) => {
    const dr = toPaise(r.dr), cr = toPaise(r.cr);
    const debitNature = r.type === 'ASSET' || r.type === 'EXPENSE';
    return { ...r, dr, cr, balance: debitNature ? dr - cr : cr - dr };
  });
}

export async function trialBalance(ctx: Ctx, asOf: ISODate = todayIST()) {
  const rows = (await balances(ctx, { to: asOf })).filter((r) => r.dr || r.cr);
  const tb = rows.map((r) => ({ ...r, debit: r.dr > r.cr ? r.dr - r.cr : 0, credit: r.cr > r.dr ? r.cr - r.dr : 0 }));
  return { asOf, rows: tb, totalDebit: tb.reduce((a, r) => a + r.debit, 0), totalCredit: tb.reduce((a, r) => a + r.credit, 0) };
}

export async function profitAndLoss(ctx: Ctx, from: ISODate, to: ISODate) {
  const rows = await balances(ctx, { from, to });
  const income = rows.filter((r) => r.type === 'INCOME' && r.balance);
  const expense = rows.filter((r) => r.type === 'EXPENSE' && r.balance);
  const ti = income.reduce((a, r) => a + r.balance, 0), te = expense.reduce((a, r) => a + r.balance, 0);
  return { from, to, income, expense, totalIncome: ti, totalExpense: te, net: ti - te };
}

export async function balanceSheet(ctx: Ctx, asOf: ISODate = todayIST()) {
  const rows = await balances(ctx, { to: asOf });
  const pick = (t: string) => rows.filter((r) => r.type === t && r.balance);
  const profit = rows.filter((r) => r.type === 'INCOME').reduce((a, r) => a + r.balance, 0) - rows.filter((r) => r.type === 'EXPENSE').reduce((a, r) => a + r.balance, 0);
  const assets = pick('ASSET'), liabilities = pick('LIABILITY'), equity = pick('EQUITY');
  const ta = assets.reduce((a, r) => a + r.balance, 0);
  const tl = liabilities.reduce((a, r) => a + r.balance, 0) + equity.reduce((a, r) => a + r.balance, 0) + profit;
  return { asOf, assets, liabilities, equity, profit, totalAssets: ta, totalLiabilitiesEquity: tl };
}

export async function dayBook(ctx: Ctx, date: ISODate, to?: ISODate) {
  const entries = await db.select().from(T.journalEntries)
    .where(and(eq(T.journalEntries.orgId, ctx.orgId), gte(T.journalEntries.date, date), lte(T.journalEntries.date, to ?? date)))
    .orderBy(asc(T.journalEntries.voucherNo));
  if (!entries.length) return [];
  const lines = await db.select({ entryId: T.journalLines.entryId, debit: T.journalLines.debit, credit: T.journalLines.credit, memo: T.journalLines.memo, account: T.accounts.name, code: T.accounts.code })
    .from(T.journalLines).innerJoin(T.accounts, eq(T.accounts.id, T.journalLines.accountId))
    .where(inArray(T.journalLines.entryId, entries.map((e) => e.id)));
  return entries.map((e) => ({ ...e, lines: lines.filter((l) => l.entryId === e.id) }));
}

export async function accountLedger(ctx: Ctx, accountId: string, from: ISODate, to: ISODate) {
  const acc = await db.query.accounts.findFirst({ where: and(eq(T.accounts.id, accountId), eq(T.accounts.orgId, ctx.orgId)) });
  if (!acc) return null;
  const opening = (await balances(ctx, { to: addDays(from, -1) })).find((r) => r.id === accountId)?.balance ?? 0;
  const lines = await db.select({ date: T.journalEntries.date, voucherNo: T.journalEntries.voucherNo, narration: T.journalEntries.narration, debit: T.journalLines.debit, credit: T.journalLines.credit })
    .from(T.journalLines).innerJoin(T.journalEntries, eq(T.journalEntries.id, T.journalLines.entryId))
    .where(and(eq(T.journalLines.accountId, accountId), gte(T.journalEntries.date, from), lte(T.journalEntries.date, to)))
    .orderBy(asc(T.journalEntries.date), asc(T.journalEntries.voucherNo));
  const debitNature = acc.type === 'ASSET' || acc.type === 'EXPENSE';
  let bal = opening;
  return { account: acc, opening, lines: lines.map((l) => { const d = toPaise(l.debit), c = toPaise(l.credit); bal += debitNature ? d - c : c - d; return { ...l, dr: d, cr: c, balance: bal }; }), closing: bal };
}

export async function gstSummary(ctx: Ctx, month: string) {
  const from = `${month}-01`, to = addDays(addMonths(from, 1), -1);
  const inv = await db.select().from(T.invoices).where(and(eq(T.invoices.orgId, ctx.orgId), gte(T.invoices.issuedAt, new Date(`${from}T00:00:00+05:30`)), lte(T.invoices.issuedAt, new Date(`${to}T23:59:59+05:30`)))).orderBy(asc(T.invoices.invoiceNo));
  const live = inv.filter((i) => i.status === 'ISSUED');
  return {
    month, invoices: inv,
    taxable: live.reduce((a, i) => a + toPaise(i.amount), 0), gst: live.reduce((a, i) => a + toPaise(i.gstAmount), 0),
    // interest on loans is exempt from GST; processing and other charges are taxable
    exemptInterest: (await profitAndLoss(ctx, from, to)).income.filter((r) => r.code === '4000' || r.code === '4010').reduce((a, r) => a + r.balance, 0),
  };
}
