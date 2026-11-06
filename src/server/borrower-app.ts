// Borrower app: phone + OTP sign-in, the borrower's own ledger, small payments, a repayment record.
import { createHash, randomInt } from 'crypto';
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { toPaise } from '@/lib/money';
import { daysBetween, todayIST } from '@/lib/dates';
import { computeDues, simpleInterest } from '@/lib/interest';
import { send } from './channels';
import { fmtNo } from './core';

const T = schema;
const h = (s: string) => createHash('sha256').update(s).digest('hex');
const last10 = (p: string) => p.replace(/\D/g, '').slice(-10);

export async function requestOtp(phone: string) {
  const p = last10(phone);
  if (p.length !== 10) return { error: 'Enter your 10-digit mobile number' };
  const b = await db.query.borrowers.findFirst({ where: sql`right(regexp_replace(${T.borrowers.phone}, '\\D', '', 'g'), 10) = ${p}` });
  if (!b) return { error: 'This number is not registered with your lender. Please contact the branch.' };
  const recent = await db.select({ n: sql<number>`count(*)::int` }).from(T.borrowerOtps).where(and(eq(T.borrowerOtps.borrowerId, b.id), gt(T.borrowerOtps.createdAt, new Date(Date.now() - 15 * 60_000))));
  if (recent[0].n >= 5) return { error: 'Too many attempts. Try again in 15 minutes.' };
  const code = String(randomInt(100000, 999999));
  await db.insert(T.borrowerOtps).values({ borrowerId: b.id, codeHash: h(`${b.id}:${code}`), expiresAt: new Date(Date.now() + 10 * 60_000) });
  const r = await send('SMS', { phone: b.phone, name: b.name }, { text: `${code} is your FinX login code. It expires in 10 minutes. Do not share it.`, language: b.language, callbackRef: 'otp' });
  // In simulation mode (no SMS gateway yet) the code is shown on screen so the app can be demonstrated.
  return { ok: true, demoCode: r.simulated ? code : undefined };
}

export async function verifyOtp(phone: string, code: string) {
  const p = last10(phone);
  const b = await db.query.borrowers.findFirst({ where: sql`right(regexp_replace(${T.borrowers.phone}, '\\D', '', 'g'), 10) = ${p}` });
  if (!b) return null;
  const otp = await db.query.borrowerOtps.findFirst({ where: and(eq(T.borrowerOtps.borrowerId, b.id), isNull(T.borrowerOtps.usedAt), gt(T.borrowerOtps.expiresAt, new Date())), orderBy: desc(T.borrowerOtps.createdAt) });
  if (!otp || otp.codeHash !== h(`${b.id}:${code.trim()}`)) return null;
  await db.update(T.borrowerOtps).set({ usedAt: new Date() }).where(eq(T.borrowerOtps.id, otp.id));
  return b;
}

export async function borrowerHome(borrowerId: string) {
  const b = await db.query.borrowers.findFirst({ where: eq(T.borrowers.id, borrowerId) });
  if (!b) return null;
  const org = await db.query.organizations.findFirst({ where: eq(T.organizations.id, b.orgId) });
  const loans = await db.select({ l: T.loans, p: T.products }).from(T.loans).innerJoin(T.products, eq(T.products.id, T.loans.productId))
    .where(and(eq(T.loans.borrowerId, borrowerId), sql`${T.loans.status} in ('ACTIVE','CLOSED','APPROVED','PENDING_APPROVAL')`)).orderBy(desc(T.loans.loanNo));
  const out = [];
  for (const { l, p } of loans) {
    const inst = await db.select().from(T.installments).where(eq(T.installments.loanId, l.id)).orderBy(asc(T.installments.seq));
    const rows = inst.map((r) => ({ seq: r.seq, dueDate: r.dueDate, principalDue: toPaise(r.principalDue), interestDue: toPaise(r.interestDue), principalPaid: toPaise(r.principalPaid), interestPaid: toPaise(r.interestPaid) }));
    const dues = l.status === 'ACTIVE' && l.startDate ? computeDues({ method: l.interestMethod, frequency: l.frequency, annualRate: Number(l.annualRate), penalRate: Number(l.penalRate), graceDays: p.graceDays, outstanding: toPaise(l.outstandingPrincipal), interestPaidTo: l.interestPaidTo, startDate: l.startDate }, rows, todayIST()) : null;
    const paid = await db.select({ s: sql<string>`coalesce(sum(${T.payments.amount}),0)` }).from(T.payments).where(and(eq(T.payments.loanId, l.id), eq(T.payments.reversed, false)));
    // "Pay ₹100 today, save ₹X": interest avoided on ₹100 of principal from today to maturity (reducing / daily loans)
    const daysLeft = l.maturityDate ? Math.max(0, daysBetween(todayIST(), l.maturityDate)) : 0;
    const save100 = l.interestMethod === 'FLAT' ? 0 : simpleInterest(10000, Number(l.annualRate), daysLeft);
    out.push({
      id: l.id, loanNo: fmtNo.loan(l.loanNo), status: l.status, product: p.name, assetType: p.assetType, lent: toPaise(l.principal), outstanding: toPaise(l.outstandingPrincipal),
      paid: toPaise(paid[0].s), rate: Number(l.annualRate), method: l.interestMethod, maturity: l.maturityDate, dues, save100, rows: inst,
    });
  }
  const receipts = await db.select({ p: T.payments, loanNo: T.loans.loanNo }).from(T.payments).innerJoin(T.loans, eq(T.loans.id, T.payments.loanId))
    .where(and(eq(T.loans.borrowerId, borrowerId), eq(T.payments.reversed, false))).orderBy(desc(T.payments.receivedAt)).limit(20);
  return { borrower: b, org, loans: out, receipts };
}

/** The borrower says they paid by UPI: file it on the loan for the branch to confirm against the bank statement. */
export async function reportPayment(borrowerId: string, loanId: string, amount: number, utr: string) {
  const l = await db.query.loans.findFirst({ where: and(eq(T.loans.id, loanId), eq(T.loans.borrowerId, borrowerId)) });
  if (!l) return { error: 'Loan not found' };
  if (!(amount > 0) || !/^\w{6,22}$/.test(utr.trim())) return { error: 'Enter the amount and the UPI reference (UTR) from your payment app' };
  await db.insert(T.communications).values({ orgId: l.orgId, borrowerId, loanId, channel: 'APP', direction: 'IN', content: `Borrower reports a UPI payment of ₹${amount.toLocaleString('en-IN')} · UTR ${utr.trim()}. Confirm against the bank statement and record the receipt.`, status: 'COMPLETED', outcome: 'PAID', provider: 'app' });
  return { ok: true };
}
