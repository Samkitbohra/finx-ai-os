// Compliance: bureau data files, KYC re-verification, statutory registers, recovery-conduct evidence.
import { and, asc, eq, inArray, lte, or, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { Ctx } from '@/lib/auth';
import { assertCan } from '@/lib/auth';
import { toPaise, fromPaise } from '@/lib/money';
import { addDays, todayIST, ISODate } from '@/lib/dates';
import { toCsv } from './accounting';
import { saveDoc } from './documents';
import { audit, fmtNo } from './core';

const T = schema;

/**
 * Monthly bureau data file. Contains every field the bureaus' consumer formats ask for; the column order follows
 * a common layout. Each bureau's own upload format (e.g. CIBIL's) is a mapping of these columns — submit it
 * under your institution's bureau membership.
 */
export async function generateBureauFile(ctx: Ctx, bureau: string, periodEnd?: string) {
  assertCan(ctx, 'compliance.run');
  const asOf: ISODate = periodEnd || todayIST();
  const rows = await db.select({
    loanNo: T.loans.loanNo, status: T.loans.status, principal: T.loans.principal, outstanding: T.loans.outstandingPrincipal, dpd: T.loans.dpd,
    start: T.loans.startDate, maturity: T.loans.maturityDate, closedAt: T.loans.closedAt, rate: T.loans.annualRate, tenure: T.loans.tenure, freq: T.loans.frequency,
    assetType: T.products.assetType, name: T.borrowers.name, dob: T.borrowers.dob, gender: T.borrowers.gender, pan: T.borrowers.pan, phone: T.borrowers.phone,
    address: T.borrowers.address, city: T.borrowers.city, state: T.borrowers.state, pincode: T.borrowers.pincode, ckyc: T.borrowers.ckycNo, code: T.borrowers.code,
  }).from(T.loans).innerJoin(T.borrowers, eq(T.borrowers.id, T.loans.borrowerId)).innerJoin(T.products, eq(T.products.id, T.loans.productId))
    .where(and(eq(T.loans.orgId, ctx.orgId), inArray(T.loans.status, ['ACTIVE', 'CLOSED', 'WRITTEN_OFF', 'AUCTIONED']), lte(T.loans.startDate, asOf)))
    .orderBy(asc(T.loans.loanNo));
  const accountType: Record<string, string> = { GOLD: 'Gold loan', VEHICLE: 'Two-wheeler loan', PROPERTY: 'Loan against property', MACHINERY: 'Business loan – machinery', BUSINESS: 'Business loan – unsecured', UNSECURED: 'Personal loan' };
  const statusCode = (s: string) => (s === 'CLOSED' ? 'Closed' : s === 'WRITTEN_OFF' ? 'Written off' : s === 'AUCTIONED' ? 'Settled – security sold' : 'Active');
  const csv = toCsv([
    ['Member reference', 'Account number', 'Consumer name', 'Date of birth', 'Gender', 'PAN', 'CKYC', 'Mobile', 'Address', 'City', 'State', 'PIN', 'Account type', 'Ownership', 'Date opened', 'Date closed', 'Sanctioned amount', 'Current balance', 'Amount overdue', 'Days past due', 'Account status', 'Rate of interest', 'Tenure', 'Repayment frequency', 'Reported as of'],
    ...rows.map((r) => [
      fmtNo.borrower(r.code), fmtNo.loan(r.loanNo), r.name, r.dob ?? '', r.gender ?? '', r.pan ?? '', r.ckyc ?? '', r.phone, r.address ?? '', r.city ?? '', r.state ?? '', r.pincode ?? '',
      accountType[r.assetType], 'Individual', r.start, r.closedAt ? r.closedAt.toISOString().slice(0, 10) : '', fromPaise(toPaise(r.principal)),
      r.status === 'ACTIVE' ? fromPaise(toPaise(r.outstanding)) : '0.00', r.dpd > 0 && r.status === 'ACTIVE' ? fromPaise(toPaise(r.outstanding)) : '0.00',
      r.status === 'ACTIVE' ? r.dpd : 0, statusCode(r.status), Number(r.rate), r.tenure, r.freq, asOf,
    ]),
  ]);
  const filename = `${bureau.toLowerCase()}-data-${asOf}.csv`;
  const doc = await saveDoc(ctx, { ownerType: 'ORG', ownerId: ctx.orgId, kind: 'BUREAU', filename, mime: 'text/csv', data: Buffer.from(csv) });
  await db.insert(T.bureauSubmissions).values({ orgId: ctx.orgId, bureau, periodEnd: asOf, recordCount: rows.length, documentId: doc.id });
  await audit(db, ctx, { action: 'bureau.generate', entity: 'organization', entityId: ctx.orgId, summary: `${bureau} data file for ${asOf}: ${rows.length} accounts` });
  return { recordCount: rows.length, filename, documentId: doc.id };
}

export async function kycDue(ctx: Ctx, withinDays = 60) {
  const limit = new Date(`${addDays(todayIST(), withinDays)}T23:59:59+05:30`);
  return db.select({ id: T.borrowers.id, code: T.borrowers.code, name: T.borrowers.name, phone: T.borrowers.phone, kyc: T.borrowers.kycStatus, due: T.borrowers.kycDueAt })
    .from(T.borrowers)
    .where(and(eq(T.borrowers.orgId, ctx.orgId), ctx.branchId ? eq(T.borrowers.branchId, ctx.branchId) : undefined, or(inArray(T.borrowers.kycStatus, ['PENDING', 'EXPIRED', 'REJECTED']), lte(T.borrowers.kycDueAt, limit), isNull(T.borrowers.kycDueAt))))
    .orderBy(asc(T.borrowers.kycDueAt)).limit(200);
}

/** Recovery-conduct evidence: every outbound contact with time, channel, rule result and outcome. */
export async function conductLog(ctx: Ctx, days = 30) {
  const since = new Date(Date.now() - days * 86400_000);
  return db.select({
    id: T.communications.id, at: T.communications.createdAt, channel: T.communications.channel, status: T.communications.status, reason: T.communications.blockReason,
    outcome: T.communications.outcome, language: T.communications.language, borrower: T.borrowers.name, loanId: T.communications.loanId, direction: T.communications.direction,
  }).from(T.communications).innerJoin(T.borrowers, eq(T.borrowers.id, T.communications.borrowerId))
    .where(and(eq(T.communications.orgId, ctx.orgId), sql`${T.communications.createdAt} >= ${since}`)).orderBy(sql`${T.communications.createdAt} desc`).limit(500);
}

/** Pledge register — the columns most state money-lending / pawnbroker rules prescribe. */
export async function pledgeRegister(ctx: Ctx, from: ISODate, to: ISODate) {
  return db.select({
    loanNo: T.loans.loanNo, date: T.loans.startDate, name: T.borrowers.name, father: T.borrowers.fatherName, address: T.borrowers.address,
    description: T.collaterals.description, details: T.collaterals.details, value: T.collaterals.value, packet: T.collaterals.packetNo,
    amount: T.loans.principal, rate: T.loans.annualRate, status: T.loans.status, closedAt: T.loans.closedAt, colStatus: T.collaterals.status,
  }).from(T.loans).innerJoin(T.borrowers, eq(T.borrowers.id, T.loans.borrowerId)).innerJoin(T.collaterals, eq(T.collaterals.loanId, T.loans.id))
    .where(and(eq(T.loans.orgId, ctx.orgId), eq(T.collaterals.assetType, 'GOLD'), ctx.branchId ? eq(T.loans.branchId, ctx.branchId) : undefined,
      sql`${T.loans.startDate} between ${from} and ${to}`)).orderBy(asc(T.loans.startDate), asc(T.loans.loanNo));
}
