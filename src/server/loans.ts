// Lending core: borrowers, loans, disbursal, repayments, closure, write-off, auction.
// Every money movement here posts a balanced journal through `post`.
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, Tx } from '@/db';
import type { Ctx } from '@/lib/auth';
import { assertCan } from '@/lib/auth';
import { UserError } from '@/lib/permissions';
import { fromPaise, Paise, toPaise, fmtP } from '@/lib/money';
import { addMonths, todayIST, ISODate, daysBetween } from '@/lib/dates';
import {
  allocatePayment, buildSchedule, computeDues, InstallmentState, LoanState, ltvPct, maturityDate, maxLoanFor, repaymentScore,
} from '@/lib/interest';
import { audit, cashKey, fmtNo, loanAccountKey, nextNo, post, reverseEntry } from './core';

type Q = Tx | typeof db;
const T = schema;

// ---------------------------------------------------------------- borrowers
export const borrowerInput = z.object({
  branchId: z.string().optional(),
  name: z.string().trim().min(2, 'Name is required'),
  fatherName: z.string().trim().optional().nullable(),
  dob: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  phone: z.string().trim().regex(/^\+?\d[\d\s-]{8,14}$/, 'Enter a valid phone number'),
  altPhone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  pincode: z.string().optional().nullable(),
  language: z.string().default('en'),
  occupation: z.string().optional().nullable(),
  monthlyIncome: z.coerce.number().optional().nullable(),
  pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'PAN looks wrong').optional().nullable().or(z.literal('')),
  aadhaarLast4: z.string().regex(/^\d{4}$/, 'Last 4 digits only').optional().nullable().or(z.literal('')),
  ckycNo: z.string().optional().nullable(),
  consentChannels: z.array(z.enum(['VOICE', 'WHATSAPP', 'EMAIL', 'SMS'])).default([]),
});
export type BorrowerInput = z.input<typeof borrowerInput>;

export async function createBorrower(ctx: Ctx, raw: BorrowerInput) {
  assertCan(ctx, 'borrower.write');
  const d = borrowerInput.parse(raw);
  const branchId = d.branchId || ctx.branchId || (await firstBranch(ctx.orgId));
  return db.transaction(async (tx) => {
    const code = await nextNo(tx, ctx.orgId, 'BORROWER');
    const [b] = await tx.insert(T.borrowers).values({
      orgId: ctx.orgId, branchId, code, name: d.name, fatherName: d.fatherName || null, dob: d.dob || null, gender: d.gender || null,
      phone: d.phone.replace(/[\s-]/g, ''), altPhone: d.altPhone || null, email: d.email || null, address: d.address || null,
      city: d.city || null, state: d.state || null, pincode: d.pincode || null, language: d.language, occupation: d.occupation || null,
      monthlyIncome: d.monthlyIncome != null ? String(d.monthlyIncome) : null, pan: d.pan || null, aadhaarLast4: d.aadhaarLast4 || null,
      ckycNo: d.ckycNo || null, consentChannels: d.consentChannels, consentAt: d.consentChannels.length ? new Date() : null,
    }).returning();
    await audit(tx, ctx, { action: 'create', entity: 'borrower', entityId: b.id, after: b, summary: `Borrower ${fmtNo.borrower(code)} ${b.name} created` });
    return b;
  });
}

export async function updateBorrower(ctx: Ctx, id: string, patch: Partial<BorrowerInput>) {
  assertCan(ctx, 'borrower.write');
  const before = await getBorrower(ctx, id);
  const d = borrowerInput.partial().parse(patch);
  const values: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) if (v !== undefined) values[k] = v === '' ? null : k === 'monthlyIncome' && v != null ? String(v) : v;
  if (d.consentChannels) values.consentAt = d.consentChannels.length ? new Date() : null;
  values.updatedAt = new Date();
  const [after] = await db.update(T.borrowers).set(values).where(eq(T.borrowers.id, id)).returning();
  await audit(db, ctx, { action: 'update', entity: 'borrower', entityId: id, before, after, summary: `Borrower ${after.name} updated: ${Object.keys(d).join(', ')}` });
  return after;
}

export async function verifyKyc(ctx: Ctx, borrowerId: string, ok = true) {
  assertCan(ctx, 'borrower.write');
  const now = new Date();
  const [b] = await db.update(T.borrowers).set({
    kycStatus: ok ? 'VERIFIED' : 'REJECTED', kycVerifiedAt: ok ? now : null,
    kycDueAt: ok ? new Date(now.getTime() + 2 * 365 * 86400_000) : null, updatedAt: now,
  }).where(and(eq(T.borrowers.id, borrowerId), eq(T.borrowers.orgId, ctx.orgId))).returning();
  await audit(db, ctx, { action: ok ? 'kyc.verify' : 'kyc.reject', entity: 'borrower', entityId: borrowerId, summary: `KYC ${ok ? 'verified' : 'rejected'} for ${b.name}` });
  return b;
}

export async function getBorrower(ctx: Ctx, id: string) {
  const b = await db.query.borrowers.findFirst({ where: and(eq(T.borrowers.id, id), eq(T.borrowers.orgId, ctx.orgId)) });
  if (!b) throw new UserError('Borrower not found');
  if (ctx.branchId && b.branchId !== ctx.branchId) throw new UserError('Borrower is in another branch');
  return b;
}

async function firstBranch(orgId: string) {
  const b = await db.query.branches.findFirst({ where: eq(T.branches.orgId, orgId), orderBy: asc(T.branches.code) });
  if (!b) throw new UserError('Create a branch first');
  return b.id;
}

// ---------------------------------------------------------------- loan origination
export const collateralInput = z.object({
  assetType: z.enum(['GOLD', 'VEHICLE', 'PROPERTY', 'MACHINERY', 'BUSINESS', 'UNSECURED']),
  description: z.string().min(2),
  value: z.coerce.number().positive('Collateral value is required'),
  details: z.record(z.any()).default({}),
  valuer: z.string().optional().nullable(),
  packetNo: z.string().optional().nullable(),
});

export const loanInput = z.object({
  borrowerId: z.string(),
  productId: z.string(),
  principal: z.coerce.number().positive('Amount must be more than zero'),
  tenure: z.coerce.number().int().positive(),
  annualRate: z.coerce.number().positive().optional(),
  purpose: z.string().optional().nullable(),
  collaterals: z.array(collateralInput).default([]),
  guarantors: z.array(z.object({ name: z.string(), phone: z.string(), relation: z.string().optional(), address: z.string().optional(), pan: z.string().optional() })).default([]),
  notes: z.string().optional().nullable(),
  submit: z.boolean().default(true),
});
export type LoanInput = z.input<typeof loanInput>;

export async function createLoan(ctx: Ctx, raw: LoanInput) {
  assertCan(ctx, 'loan.create');
  const d = loanInput.parse(raw);
  const borrower = await getBorrower(ctx, d.borrowerId);
  const product = await db.query.products.findFirst({ where: and(eq(T.products.id, d.productId), eq(T.products.orgId, ctx.orgId)) });
  if (!product || !product.active) throw new UserError('Product not found');
  const P = toPaise(d.principal);
  if (P < toPaise(product.minAmount) || P > toPaise(product.maxAmount))
    throw new UserError(`${product.name} allows ${fmtP(toPaise(product.minAmount))} to ${fmtP(toPaise(product.maxAmount))}`);
  if (d.tenure < product.minTenure || d.tenure > product.maxTenure)
    throw new UserError(`${product.name} allows a tenure of ${product.minTenure}–${product.maxTenure}`);

  const collateralValue = d.collaterals.reduce((a, c) => a + toPaise(c.value), 0);
  let ltv: number | null = null;
  if (product.maxLtv != null) {
    if (!d.collaterals.length) throw new UserError(`${product.name} needs collateral`);
    ltv = ltvPct(P, collateralValue);
    const cap = maxLoanFor(collateralValue, Number(product.maxLtv), product.ltvTiers);
    if (P > cap) throw new UserError(`LTV ${ltv}% is above the cap. Maximum loan against this collateral is ${fmtP(cap)}.`);
  }

  return db.transaction(async (tx) => {
    const loanNo = await nextNo(tx, ctx.orgId, 'LOAN');
    const [loan] = await tx.insert(T.loans).values({
      orgId: ctx.orgId, branchId: borrower.branchId, borrowerId: borrower.id, productId: product.id, loanNo,
      status: d.submit ? 'PENDING_APPROVAL' : 'DRAFT', purpose: d.purpose || null, principal: fromPaise(P),
      annualRate: String(d.annualRate ?? product.annualRate), penalRate: product.penalRate, interestMethod: product.interestMethod,
      frequency: product.frequency, tenure: d.tenure, ltvAtSanction: ltv != null ? String(ltv) : null,
      collateralValue: collateralValue ? fromPaise(collateralValue) : null, officerId: ctx.userId, notes: d.notes || null,
    }).returning();
    if (d.collaterals.length)
      await tx.insert(T.collaterals).values(d.collaterals.map((c) => ({
        borrowerId: borrower.id, loanId: loan.id, assetType: c.assetType, description: c.description, details: c.details,
        value: fromPaise(toPaise(c.value)), valuer: c.valuer || null, packetNo: c.packetNo || null,
        valuations: [{ date: todayIST(), value: c.value, valuer: c.valuer || undefined }],
      })));
    if (d.guarantors.length) await tx.insert(T.guarantors).values(d.guarantors.map((g) => ({ ...g, loanId: loan.id })));
    await audit(tx, ctx, { action: 'create', entity: 'loan', entityId: loan.id, after: loan, summary: `Loan ${fmtNo.loan(loanNo)} for ${borrower.name}: ${fmtP(P)}${ltv != null ? `, LTV ${ltv}%` : ''}` });
    return loan;
  });
}

async function loadLoan(q: Q, ctx: Ctx, loanId: string) {
  const loan = await q.query.loans.findFirst({ where: and(eq(T.loans.id, loanId), eq(T.loans.orgId, ctx.orgId)) });
  if (!loan) throw new UserError('Loan not found');
  if (ctx.branchId && loan.branchId !== ctx.branchId) throw new UserError('Loan is in another branch');
  return loan;
}

export async function findLoanByNo(ctx: Ctx, loanNo: number) {
  const loan = await db.query.loans.findFirst({ where: and(eq(T.loans.orgId, ctx.orgId), eq(T.loans.loanNo, loanNo)) });
  if (!loan) throw new UserError(`Loan ${loanNo} not found`);
  return loan;
}

export async function approveLoan(ctx: Ctx, loanId: string, approve = true, reason?: string) {
  assertCan(ctx, 'loan.approve');
  const loan = await loadLoan(db, ctx, loanId);
  if (!['PENDING_APPROVAL', 'DRAFT'].includes(loan.status)) throw new UserError(`Loan is ${loan.status.toLowerCase()}, not awaiting approval`);
  if (approve && loan.officerId === ctx.userId && !['OWNER', 'ADMIN'].includes(ctx.role))
    throw new UserError('Maker-checker: someone other than the officer who created the loan must approve it');
  const [after] = await db.update(T.loans).set({
    status: approve ? 'APPROVED' : 'REJECTED', approvedById: approve ? ctx.userId : null, approvedAt: approve ? new Date() : null,
    notes: reason ? `${loan.notes ?? ''}\n${approve ? 'Approved' : 'Rejected'}: ${reason}`.trim() : loan.notes, updatedAt: new Date(),
  }).where(eq(T.loans.id, loanId)).returning();
  await audit(db, ctx, { action: approve ? 'approve' : 'reject', entity: 'loan', entityId: loanId, before: { status: loan.status }, after: { status: after.status }, summary: `Loan ${fmtNo.loan(loan.loanNo)} ${approve ? 'approved' : 'rejected'}` });
  return after;
}

export const disburseInput = z.object({
  mode: z.enum(['CASH', 'UPI', 'NEFT', 'CHEQUE', 'CARD']),
  reference: z.string().optional().nullable(),
  payee: z.string().optional().nullable(),
  date: z.string().optional(),
  deductFee: z.boolean().default(true),
});

export async function disburseLoan(ctx: Ctx, loanId: string, raw: z.input<typeof disburseInput>) {
  assertCan(ctx, 'loan.disburse');
  const d = disburseInput.parse(raw);
  const date: ISODate = d.date || todayIST();
  return db.transaction(async (tx) => {
    const loan = await loadLoan(tx, ctx, loanId);
    if (loan.status !== 'APPROVED') throw new UserError('Only approved loans can be disbursed');
    const product = await tx.query.products.findFirst({ where: eq(T.products.id, loan.productId) });
    const borrower = await tx.query.borrowers.findFirst({ where: eq(T.borrowers.id, loan.borrowerId) });
    if (!product || !borrower) throw new Error('Loan is missing its product or borrower');
    if (borrower.kycStatus !== 'VERIFIED') throw new UserError('Verify the borrower’s KYC before disbursal');

    const P = toPaise(loan.principal);
    const rows = buildSchedule({ principal: P, annualRate: Number(loan.annualRate), method: loan.interestMethod, frequency: loan.frequency, tenure: loan.tenure, startDate: date });
    await tx.insert(T.installments).values(rows.map((r) => ({ loanId, seq: r.seq, dueDate: r.dueDate, principalDue: fromPaise(r.principalDue), interestDue: fromPaise(r.interestDue) })));

    const fee = Math.round((P * Number(product.processingFeePct)) / 100);
    const gst = Math.round((fee * Number(product.gstRate)) / 100);
    const net = d.deductFee ? P - fee - gst : P;

    await tx.insert(T.disbursements).values({ loanId, amount: fromPaise(net), mode: d.mode, reference: d.reference || null, payee: d.payee || null, at: new Date(`${date}T06:30:00Z`) });
    const mat = maturityDate({ startDate: date, frequency: loan.frequency, tenure: loan.tenure });
    const [after] = await tx.update(T.loans).set({
      status: 'ACTIVE', startDate: date, maturityDate: mat, outstandingPrincipal: fromPaise(P), interestPaidTo: date,
      processingFee: fromPaise(fee), updatedAt: new Date(),
    }).where(eq(T.loans.id, loanId)).returning();

    let invoiceNo: number | null = null;
    if (fee > 0) {
      invoiceNo = await nextNo(tx, ctx.orgId, 'INVOICE');
      await tx.insert(T.invoices).values({
        orgId: ctx.orgId, invoiceNo, borrowerId: borrower.id, loanId, kind: 'PROCESSING_FEE', description: `Processing charges · loan ${fmtNo.loan(loan.loanNo)}`,
        amount: fromPaise(fee), gstRate: product.gstRate, gstAmount: fromPaise(gst), total: fromPaise(fee + gst),
      });
    }
    const acct = loanAccountKey(product.assetType);
    await post(tx, ctx, {
      date, branchId: loan.branchId, sourceType: 'DISBURSAL', sourceId: loanId,
      narration: `Disbursal · loan ${fmtNo.loan(loan.loanNo)} · ${borrower.name}${d.payee ? ` · paid to ${d.payee}` : ''}`,
      lines: d.deductFee
        ? [
            { account: acct, debit: P, loanId },
            { account: cashKey(d.mode), credit: net },
            { account: 'FEE_INCOME', credit: fee, loanId, memo: invoiceNo ? fmtNo.invoice(invoiceNo) : undefined },
            { account: 'GST_OUTPUT', credit: gst, loanId },
          ]
        : [
            { account: acct, debit: P, loanId },
            { account: cashKey(d.mode), credit: P },
          ],
    });
    await audit(tx, ctx, { action: 'disburse', entity: 'loan', entityId: loanId, after: { status: 'ACTIVE', net: fromPaise(net), date }, summary: `Disbursed ${fmtP(net)} on loan ${fmtNo.loan(loan.loanNo)} by ${d.mode}` });
    return after;
  });
}

// ---------------------------------------------------------------- servicing
const stateOf = (loan: typeof T.loans.$inferSelect, graceDays: number): LoanState => ({
  method: loan.interestMethod, frequency: loan.frequency, annualRate: Number(loan.annualRate), penalRate: Number(loan.penalRate),
  graceDays, outstanding: toPaise(loan.outstandingPrincipal), interestPaidTo: loan.interestPaidTo, startDate: loan.startDate!,
});

const rowsOf = (rows: (typeof T.installments.$inferSelect)[]): (InstallmentState & { id: string })[] =>
  rows.map((r) => ({ id: r.id, seq: r.seq, dueDate: r.dueDate, principalDue: toPaise(r.principalDue), interestDue: toPaise(r.interestDue), principalPaid: toPaise(r.principalPaid), interestPaid: toPaise(r.interestPaid) }));

async function graceFor(q: Q, productId: string) {
  const p = await q.query.products.findFirst({ where: eq(T.products.id, productId), columns: { graceDays: true, assetType: true } });
  return p!;
}

export async function getDues(ctx: Ctx, loanId: string, asOf: ISODate = todayIST()) {
  const loan = await loadLoan(db, ctx, loanId);
  if (!loan.startDate) return null;
  const p = await graceFor(db, loan.productId);
  const rows = await db.select().from(T.installments).where(eq(T.installments.loanId, loanId)).orderBy(asc(T.installments.seq));
  return computeDues(stateOf(loan, p.graceDays), rowsOf(rows), asOf);
}

export const paymentInput = z.object({
  amount: z.coerce.number().positive('Enter an amount'),
  mode: z.enum(['CASH', 'UPI', 'NEFT', 'CHEQUE', 'CARD']),
  reference: z.string().optional().nullable(),
  date: z.string().optional(),
});

export async function recordPayment(ctx: Ctx, loanId: string, raw: z.input<typeof paymentInput>) {
  assertCan(ctx, 'payment.record');
  const d = paymentInput.parse(raw);
  const date: ISODate = d.date || todayIST();
  if (date > todayIST()) throw new UserError('Payment date cannot be in the future');
  const amount = toPaise(d.amount);
  return db.transaction(async (tx) => {
    const loan = await loadLoan(tx, ctx, loanId);
    if (loan.status !== 'ACTIVE') throw new UserError(`Loan is ${loan.status.toLowerCase()}; payments can only be taken on active loans`);
    if (loan.startDate && date < loan.startDate) throw new UserError('Payment date is before disbursal');
    const p = await graceFor(tx, loan.productId);
    const dbRows = await tx.select().from(T.installments).where(eq(T.installments.loanId, loanId)).orderBy(asc(T.installments.seq));
    const rows = rowsOf(dbRows);
    const a = allocatePayment(stateOf(loan, p.graceDays), rows, amount, date);

    for (const r of a.rows as (InstallmentState & { id: string })[]) {
      const paid = r.principalPaid >= r.principalDue && r.interestPaid >= r.interestDue;
      const partial = r.principalPaid + r.interestPaid > 0;
      await tx.update(T.installments).set({
        principalDue: fromPaise(r.principalDue), interestDue: fromPaise(r.interestDue), principalPaid: fromPaise(r.principalPaid),
        interestPaid: fromPaise(r.interestPaid), status: paid ? 'PAID' : partial ? 'PARTIAL' : 'DUE', paidAt: paid ? new Date(`${date}T06:30:00Z`) : null,
      }).where(eq(T.installments.id, r.id));
    }
    const receiptNo = await nextNo(tx, ctx.orgId, 'RECEIPT');
    const [payment] = await tx.insert(T.payments).values({
      orgId: ctx.orgId, loanId, receiptNo, amount: fromPaise(amount), mode: d.mode, reference: d.reference || null,
      receivedAt: date === todayIST() ? new Date() : new Date(`${date}T06:30:00Z`),
      toPenalty: fromPaise(a.toPenalty), toInterest: fromPaise(a.toInterest), toPrincipal: fromPaise(a.toPrincipal),
      collectedById: ctx.userId, via: ctx.via,
    }).returning();

    const dues = computeDues({ ...stateOf(loan, p.graceDays), outstanding: a.outstanding, interestPaidTo: a.interestPaidTo }, a.rows, date);
    const [after] = await tx.update(T.loans).set({
      outstandingPrincipal: fromPaise(a.outstanding), interestPaidTo: a.interestPaidTo,
      totalInterestPaid: fromPaise(toPaise(loan.totalInterestPaid) + a.toInterest), totalPenaltyPaid: fromPaise(toPaise(loan.totalPenaltyPaid) + a.toPenalty),
      dpd: dues.dpd, status: a.closed ? 'CLOSED' : 'ACTIVE', closedAt: a.closed ? new Date() : null, updatedAt: new Date(),
    }).where(eq(T.loans.id, loanId)).returning();
    if (a.closed) await tx.update(T.collaterals).set({ status: 'RELEASED', releasedAt: new Date() }).where(and(eq(T.collaterals.loanId, loanId), eq(T.collaterals.status, 'PLEDGED')));

    const borrower = await tx.query.borrowers.findFirst({ where: eq(T.borrowers.id, loan.borrowerId), columns: { name: true } });
    await post(tx, ctx, {
      date, branchId: loan.branchId, sourceType: 'RECEIPT', sourceId: payment.id,
      narration: `${d.mode} receipt ${fmtNo.receipt(receiptNo)} · loan ${fmtNo.loan(loan.loanNo)} · ${borrower?.name ?? ''}`,
      lines: [
        { account: cashKey(d.mode), debit: amount },
        { account: 'PENAL_INCOME', credit: a.toPenalty, loanId },
        { account: 'INTEREST_INCOME', credit: a.toInterest, loanId },
        { account: loanAccountKey(p.assetType), credit: a.toPrincipal, loanId },
        { account: 'UNAPPLIED', credit: a.unapplied, loanId, memo: 'Excess over payoff' },
      ],
    });
    await audit(tx, ctx, {
      action: 'payment', entity: 'loan', entityId: loanId, after: { receiptNo, amount: fromPaise(amount), ...a, rows: undefined },
      summary: `${fmtNo.receipt(receiptNo)}: ${fmtP(amount)} on loan ${fmtNo.loan(loan.loanNo)} → penalty ${fmtP(a.toPenalty)}, interest ${fmtP(a.toInterest)}, principal ${fmtP(a.toPrincipal)}${a.closed ? ' · loan closed' : ''}`,
    });
    await refreshScore(tx, loan.borrowerId);
    return { payment, loan: after, allocation: { ...a, rows: undefined }, dues };
  });
}

/** Reverse the most recent receipt on a loan (bounced cheque, wrong entry) and rebuild the loan from its schedule. */
export async function reversePayment(ctx: Ctx, paymentId: string, reason: string) {
  assertCan(ctx, 'payment.reverse');
  if (!reason?.trim()) throw new UserError('Give a reason for the reversal');
  return db.transaction(async (tx) => {
    const pay = await tx.query.payments.findFirst({ where: and(eq(T.payments.id, paymentId), eq(T.payments.orgId, ctx.orgId)) });
    if (!pay || pay.reversed) throw new UserError('Receipt not found or already reversed');
    const latest = await tx.query.payments.findFirst({ where: and(eq(T.payments.loanId, pay.loanId), eq(T.payments.reversed, false)), orderBy: desc(T.payments.receivedAt) });
    if (latest?.id !== pay.id) throw new UserError('Only the latest receipt on a loan can be reversed. Reverse later receipts first.');
    const loan = await loadLoan(tx, ctx, pay.loanId);
    await tx.update(T.payments).set({ reversed: true }).where(eq(T.payments.id, paymentId));
    await rebuildLoan(tx, loan);
    const je = await tx.query.journalEntries.findFirst({ where: and(eq(T.journalEntries.sourceId, paymentId), eq(T.journalEntries.sourceType, 'RECEIPT')) });
    if (je) await reverseEntry(tx, ctx, je.id, todayIST(), reason);
    if (loan.status === 'CLOSED') await tx.update(T.collaterals).set({ status: 'PLEDGED', releasedAt: null }).where(eq(T.collaterals.loanId, loan.id));
    await audit(tx, ctx, { action: 'payment.reverse', entity: 'loan', entityId: loan.id, before: pay, summary: `${fmtNo.receipt(pay.receiptNo)} of ${fmtP(toPaise(pay.amount))} reversed: ${reason}` });
    await refreshScore(tx, loan.borrowerId);
  });
}

/** Rebuild instalments and balances by replaying every non-reversed receipt over the original schedule. */
async function rebuildLoan(tx: Tx, loan: typeof T.loans.$inferSelect) {
  const p = await graceFor(tx, loan.productId);
  const base = buildSchedule({ principal: toPaise(loan.principal), annualRate: Number(loan.annualRate), method: loan.interestMethod, frequency: loan.frequency, tenure: loan.tenure, startDate: loan.startDate! });
  let rows: InstallmentState[] = base.map((r) => ({ ...r, principalPaid: 0, interestPaid: 0 }));
  let st: LoanState = { ...stateOf(loan, p.graceDays), outstanding: toPaise(loan.principal), interestPaidTo: loan.startDate };
  let interest = 0, penalty = 0;
  const pays = await tx.select().from(T.payments).where(and(eq(T.payments.loanId, loan.id), eq(T.payments.reversed, false))).orderBy(asc(T.payments.receivedAt));
  for (const pay of pays) {
    const date = new Date(pay.receivedAt.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    const a = allocatePayment(st, rows, toPaise(pay.amount), date);
    rows = a.rows; st = { ...st, outstanding: a.outstanding, interestPaidTo: a.interestPaidTo };
    interest += a.toInterest; penalty += a.toPenalty;
    await tx.update(T.payments).set({ toPenalty: fromPaise(a.toPenalty), toInterest: fromPaise(a.toInterest), toPrincipal: fromPaise(a.toPrincipal) }).where(eq(T.payments.id, pay.id));
  }
  const existing = await tx.select({ id: T.installments.id, seq: T.installments.seq }).from(T.installments).where(eq(T.installments.loanId, loan.id));
  const bySeq = new Map(existing.map((e) => [e.seq, e.id]));
  for (const r of rows) {
    const paid = r.principalPaid >= r.principalDue && r.interestPaid >= r.interestDue;
    await tx.update(T.installments).set({
      dueDate: r.dueDate, principalDue: fromPaise(r.principalDue), interestDue: fromPaise(r.interestDue), principalPaid: fromPaise(r.principalPaid),
      interestPaid: fromPaise(r.interestPaid), status: paid ? 'PAID' : r.principalPaid + r.interestPaid > 0 ? 'PARTIAL' : 'DUE', paidAt: paid ? new Date() : null,
    }).where(eq(T.installments.id, bySeq.get(r.seq)!));
  }
  const dues = computeDues(st, rows, todayIST());
  await tx.update(T.loans).set({
    outstandingPrincipal: fromPaise(st.outstanding), interestPaidTo: st.interestPaidTo, totalInterestPaid: fromPaise(interest), totalPenaltyPaid: fromPaise(penalty),
    dpd: dues.dpd, status: st.outstanding <= 0 ? 'CLOSED' : 'ACTIVE', closedAt: st.outstanding <= 0 ? new Date() : null, updatedAt: new Date(),
  }).where(eq(T.loans.id, loan.id));
}

export async function writeOffLoan(ctx: Ctx, loanId: string, reason: string) {
  assertCan(ctx, 'loan.writeoff');
  return db.transaction(async (tx) => {
    const loan = await loadLoan(tx, ctx, loanId);
    if (loan.status !== 'ACTIVE') throw new UserError('Only active loans can be written off');
    const p = await graceFor(tx, loan.productId);
    const out = toPaise(loan.outstandingPrincipal);
    await post(tx, ctx, {
      date: todayIST(), branchId: loan.branchId, sourceType: 'WRITE_OFF', sourceId: loanId, narration: `Write-off · loan ${fmtNo.loan(loan.loanNo)} · ${reason}`,
      lines: [{ account: 'BAD_DEBTS', debit: out, loanId }, { account: loanAccountKey(p.assetType), credit: out, loanId }],
    });
    await tx.update(T.loans).set({ status: 'WRITTEN_OFF', closedAt: new Date(), updatedAt: new Date() }).where(eq(T.loans.id, loanId));
    await audit(tx, ctx, { action: 'writeoff', entity: 'loan', entityId: loanId, summary: `Loan ${fmtNo.loan(loan.loanNo)} written off (${fmtP(out)}): ${reason}` });
  });
}

/** Gold auction: sale proceeds clear dues; any surplus is owed to the borrower; any shortfall is a loss. */
export async function auctionLoan(ctx: Ctx, loanId: string, saleAmount: number, mode: 'CASH' | 'NEFT' | 'UPI' = 'NEFT') {
  assertCan(ctx, 'loan.writeoff');
  const loan = await loadLoan(db, ctx, loanId);
  if (loan.status !== 'ACTIVE') throw new UserError('Only active loans can be auctioned');
  const dues = await getDues(ctx, loanId);
  if (!dues) throw new UserError('Loan has not been disbursed');
  const sale = toPaise(saleAmount);
  const applied = Math.min(sale, dues.payoff);
  if (applied > 0) await recordPayment({ ...ctx, via: 'SYSTEM' }, loanId, { amount: applied / 100, mode, reference: 'Auction proceeds' });
  return db.transaction(async (tx) => {
    const p = await graceFor(tx, loan.productId);
    const fresh = await loadLoan(tx, ctx, loanId);
    const short = toPaise(fresh.outstandingPrincipal);
    const surplus = sale - applied;
    if (surplus > 0) await post(tx, ctx, { date: todayIST(), branchId: loan.branchId, sourceType: 'AUCTION', sourceId: loanId, narration: `Auction surplus · loan ${fmtNo.loan(loan.loanNo)} · payable to borrower`, lines: [{ account: cashKey(mode), debit: surplus }, { account: 'BORROWER_PAYABLE', credit: surplus, loanId }] });
    if (short > 0) await post(tx, ctx, { date: todayIST(), branchId: loan.branchId, sourceType: 'AUCTION', sourceId: loanId, narration: `Auction shortfall · loan ${fmtNo.loan(loan.loanNo)}`, lines: [{ account: 'AUCTION_LOSS', debit: short, loanId }, { account: loanAccountKey(p.assetType), credit: short, loanId }] });
    await tx.update(T.loans).set({ status: 'AUCTIONED', closedAt: new Date(), updatedAt: new Date() }).where(eq(T.loans.id, loanId));
    await tx.update(T.collaterals).set({ status: 'AUCTIONED' }).where(eq(T.collaterals.loanId, loanId));
    await audit(tx, ctx, { action: 'auction', entity: 'loan', entityId: loanId, summary: `Loan ${fmtNo.loan(loan.loanNo)} auctioned for ${fmtP(sale)}; surplus ${fmtP(Math.max(0, surplus))}, shortfall ${fmtP(short)}` });
  });
}

// ---------------------------------------------------------------- invoices
/** Re-issue an invoice at a corrected GST rate. The amount collected is unchanged; it is re-split into fee and GST. */
export async function reissueInvoice(ctx: Ctx, invoiceNo: number, gstRate: number) {
  assertCan(ctx, 'invoice.write');
  return db.transaction(async (tx) => {
    const inv = await tx.query.invoices.findFirst({ where: and(eq(T.invoices.orgId, ctx.orgId), eq(T.invoices.invoiceNo, invoiceNo)) });
    if (!inv) throw new UserError(`Invoice ${invoiceNo} not found`);
    if (inv.status !== 'ISSUED') throw new UserError(`Invoice ${invoiceNo} has already been ${inv.status.toLowerCase()}`);
    const total = toPaise(inv.total);
    const newAmt = Math.round(total / (1 + gstRate / 100));
    const newGst = total - newAmt;
    const oldAmt = toPaise(inv.amount), oldGst = toPaise(inv.gstAmount);
    const no = await nextNo(tx, ctx.orgId, 'INVOICE');
    const [fresh] = await tx.insert(T.invoices).values({
      orgId: ctx.orgId, invoiceNo: no, borrowerId: inv.borrowerId, loanId: inv.loanId, kind: inv.kind, description: inv.description,
      amount: fromPaise(newAmt), gstRate: String(gstRate), gstAmount: fromPaise(newGst), total: fromPaise(total), replacesId: inv.id,
    }).returning();
    await tx.update(T.invoices).set({ status: 'REISSUED' }).where(eq(T.invoices.id, inv.id));
    const dFee = newAmt - oldAmt; // + means more fee income
    await post(tx, ctx, {
      date: todayIST(), sourceType: 'INVOICE', sourceId: fresh.id, narration: `${fmtNo.invoice(no)} replaces ${fmtNo.invoice(invoiceNo)} · GST corrected to ${gstRate}%`,
      lines: [
        { account: 'FEE_INCOME', debit: dFee < 0 ? -dFee : 0, credit: dFee > 0 ? dFee : 0, loanId: inv.loanId },
        { account: 'GST_OUTPUT', debit: newGst - oldGst < 0 ? oldGst - newGst : 0, credit: newGst - oldGst > 0 ? newGst - oldGst : 0, loanId: inv.loanId },
      ],
    });
    await audit(tx, ctx, { action: 'invoice.reissue', entity: 'invoice', entityId: fresh.id, before: inv, after: fresh, summary: `${fmtNo.invoice(invoiceNo)} re-issued as ${fmtNo.invoice(no)} at ${gstRate}% GST` });
    return fresh;
  });
}

// ---------------------------------------------------------------- scores and daily refresh
async function refreshScore(q: Q, borrowerId: string) {
  const loansOf = await q.select({ id: T.loans.id, status: T.loans.status, dpd: T.loans.dpd }).from(T.loans).where(eq(T.loans.borrowerId, borrowerId));
  const ids = loansOf.map((l) => l.id);
  if (!ids.length) return;
  const inst = await q.select({ due: T.installments.dueDate, status: T.installments.status, paidAt: T.installments.paidAt }).from(T.installments).where(inArray(T.installments.loanId, ids));
  let onTime = 0, late = 0;
  for (const i of inst) {
    if (i.status !== 'PAID' || !i.paidAt) continue;
    const paid = new Date(i.paidAt.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    if (daysBetween(i.due, paid) <= 3) onTime++; else late++;
  }
  const score = repaymentScore({ onTime, late, currentDpd: Math.max(0, ...loansOf.filter((l) => l.status === 'ACTIVE').map((l) => l.dpd)), closedLoans: loansOf.filter((l) => l.status === 'CLOSED').length });
  await q.update(T.borrowers).set({ repaymentScore: score }).where(eq(T.borrowers.id, borrowerId));
}

/** Recompute DPD on every active loan (run daily, and on dashboard load). */
export async function refreshPortfolio(orgId: string, asOf: ISODate = todayIST()) {
  const active = await db.select().from(T.loans).where(and(eq(T.loans.orgId, orgId), eq(T.loans.status, 'ACTIVE')));
  if (!active.length) return 0;
  const inst = await db.select().from(T.installments).where(inArray(T.installments.loanId, active.map((l) => l.id))).orderBy(asc(T.installments.seq));
  const byLoan = new Map<string, typeof inst>();
  for (const i of inst) byLoan.set(i.loanId, [...(byLoan.get(i.loanId) ?? []), i]);
  const prods = await db.select({ id: T.products.id, graceDays: T.products.graceDays }).from(T.products).where(eq(T.products.orgId, orgId));
  const grace = new Map(prods.map((p) => [p.id, p.graceDays]));
  let changed = 0;
  for (const l of active) {
    const d = computeDues(stateOf(l, grace.get(l.productId) ?? 3), rowsOf(byLoan.get(l.id) ?? []), asOf);
    if (d.dpd !== l.dpd) { await db.update(T.loans).set({ dpd: d.dpd }).where(eq(T.loans.id, l.id)); changed++; }
  }
  return changed;
}

export const loanLabel = (l: { loanNo: number }) => `Loan ${fmtNo.loan(l.loanNo)}`;
export { addMonths, ne, sql };
