// Document vault: uploads, generated agreements and notices, counter signatures with a tamper log.
// Files live under STORAGE_DIR (swap for S3/GCS in production — only put/get below need to change).
import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { Ctx } from '@/lib/auth';
import { UserError } from '@/lib/permissions';
import { fmtP, toPaise } from '@/lib/money';
import { fmtDate, todayIST } from '@/lib/dates';
import { audit, fmtNo } from './core';
import { createId } from '@/db/id';

const T = schema;
// Serverless hosts only allow writing to /tmp.
const root = () => path.resolve(process.env.STORAGE_DIR || (process.env.NETLIFY || process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME ? '/tmp/finx-storage' : './storage'));
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

async function put(orgId: string, name: string, data: Buffer) {
  const key = `${orgId}/${createId()}-${name.replace(/[^\w.-]/g, '_')}`;
  const full = path.join(root(), key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
  return key;
}
export async function getFile(ctx: Ctx, id: string) {
  const d = await db.query.documents.findFirst({ where: and(eq(T.documents.id, id), eq(T.documents.orgId, ctx.orgId)) });
  if (!d) return null;
  const data = await readFile(path.join(root(), d.storageKey));
  const intact = sha(data) === d.sha256;
  return { doc: d, data, intact };
}

export async function saveDoc(ctx: Ctx, a: { ownerType: string; ownerId: string; kind: string; filename: string; mime: string; data: Buffer }) {
  const key = await put(ctx.orgId, a.filename, a.data);
  const hash = sha(a.data);
  const [d] = await db.insert(T.documents).values({
    orgId: ctx.orgId, ownerType: a.ownerType, ownerId: a.ownerId, kind: a.kind, filename: a.filename, mime: a.mime, size: a.data.length,
    sha256: hash, storageKey: key, tamperLog: [{ at: new Date().toISOString(), action: 'created', by: ctx.name, sha256: hash }],
  }).returning();
  await audit(db, ctx, { action: 'document.add', entity: a.ownerType.toLowerCase(), entityId: a.ownerId, summary: `${a.kind.toLowerCase()} added: ${a.filename}` });
  return d;
}

export async function saveUpload(ctx: Ctx, a: { ownerType: string; ownerId: string; kind: string; file: File }) {
  if (a.file.size > 10 * 1024 * 1024) throw new UserError('Files up to 10 MB');
  const data = Buffer.from(await a.file.arrayBuffer());
  return saveDoc(ctx, { ownerType: a.ownerType, ownerId: a.ownerId, kind: a.kind, filename: a.file.name, mime: a.file.type || 'application/octet-stream', data });
}

/**
 * Counter signature at the branch: the drawn signature is stored with the document, and the document's hash,
 * the signer and the time are appended to its tamper log. Aadhaar eSign can be plugged in through an ESP later.
 */
export async function signDocument(ctx: Ctx, id: string, s: { signerName: string; signature: string }) {
  if (!s.signerName.trim() || !s.signature.startsWith('data:image/')) throw new UserError('Add the signer’s name and signature');
  const f = await getFile(ctx, id);
  if (!f) throw new UserError('Document not found');
  if (!f.intact) throw new UserError('This document has changed since it was filed and cannot be signed');
  const log = [...f.doc.tamperLog, { at: new Date().toISOString(), action: `signed by ${s.signerName}`, by: ctx.name, sha256: f.doc.sha256 }];
  await db.update(T.documents).set({ signed: true, signedAt: new Date(), signerName: s.signerName, signature: s.signature, tamperLog: log }).where(eq(T.documents.id, id));
  await audit(db, ctx, { action: 'document.sign', entity: f.doc.ownerType.toLowerCase(), entityId: f.doc.ownerId, summary: `${f.doc.filename} signed by ${s.signerName}` });
}

/** Generate the loan agreement and key fact statement as a printable HTML document. */
export async function generateAgreement(ctx: Ctx, loanId: string) {
  const loan = await db.query.loans.findFirst({ where: and(eq(T.loans.id, loanId), eq(T.loans.orgId, ctx.orgId)) });
  if (!loan) throw new UserError('Loan not found');
  const [org, b, p, inst, cols] = await Promise.all([
    db.query.organizations.findFirst({ where: eq(T.organizations.id, ctx.orgId) }),
    db.query.borrowers.findFirst({ where: eq(T.borrowers.id, loan.borrowerId) }),
    db.query.products.findFirst({ where: eq(T.products.id, loan.productId) }),
    db.select().from(T.installments).where(eq(T.installments.loanId, loanId)).orderBy(asc(T.installments.seq)),
    db.select().from(T.collaterals).where(eq(T.collaterals.loanId, loanId)),
  ]);
  const totalInterest = inst.reduce((a, r) => a + toPaise(r.interestDue), 0);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Loan agreement ${fmtNo.loan(loan.loanNo)}</title>
<style>body{font:14px/1.55 Helvetica,Arial,sans-serif;color:#111;max-width:760px;margin:32px auto;padding:0 20px}h1{font-size:20px}h2{font-size:15px;margin-top:22px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 8px;text-align:left;font-size:13px}th{background:#f3f5f9}.r{text-align:right}</style></head><body>
<h1>${org?.name} — Loan agreement and key fact statement</h1>
<p>${org?.legalName ?? ''} · ${org?.address ?? ''} · Licence ${org?.licenseNo ?? '—'} · GSTIN ${org?.gstin ?? '—'}</p>
<h2>Key facts</h2><table>
<tr><th>Loan number</th><td>${fmtNo.loan(loan.loanNo)}</td><th>Date</th><td>${fmtDate(loan.startDate ?? todayIST())}</td></tr>
<tr><th>Borrower</th><td>${b?.name} (${fmtNo.borrower(b!.code)})</td><th>Phone</th><td>${b?.phone}</td></tr>
<tr><th>Product</th><td>${p?.name}</td><th>Amount</th><td>${fmtP(toPaise(loan.principal))}</td></tr>
<tr><th>Interest</th><td>${Number(loan.annualRate)}% a year, ${loan.interestMethod === 'FLAT' ? 'flat on the original amount' : loan.interestMethod === 'DAILY' ? 'calculated daily on the amount outstanding' : 'on the reducing balance'}</td><th>Penal interest</th><td>${Number(loan.penalRate)}% a year extra on overdue amounts, after ${p?.graceDays} days</td></tr>
<tr><th>Tenure</th><td>${loan.tenure} ${loan.frequency === 'WEEKLY' ? 'weeks' : loan.frequency === 'DAILY' ? 'days' : 'months'}</td><th>Processing charges</th><td>${fmtP(toPaise(loan.processingFee))} + GST</td></tr>
<tr><th>Total interest (if paid on time)</th><td>${fmtP(totalInterest)}</td><th>Maturity</th><td>${fmtDate(loan.maturityDate)}</td></tr>
</table>
${cols.length ? `<h2>Security</h2><table><tr><th>Item</th><th>Details</th><th class="r">Value</th></tr>${cols.map((c) => `<tr><td>${c.description}</td><td>${Object.entries(c.details).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ')}</td><td class="r">${fmtP(toPaise(c.value))}</td></tr>`).join('')}</table>` : ''}
<h2>Repayment schedule</h2><table><tr><th>#</th><th>Due</th><th class="r">Principal</th><th class="r">Interest</th><th class="r">Total</th></tr>
${inst.map((r) => `<tr><td>${r.seq}</td><td>${fmtDate(r.dueDate)}</td><td class="r">${fmtP(toPaise(r.principalDue))}</td><td class="r">${fmtP(toPaise(r.interestDue))}</td><td class="r">${fmtP(toPaise(r.principalDue) + toPaise(r.interestDue))}</td></tr>`).join('')}</table>
<h2>Terms</h2><ol>
<li>Payments are applied first to penal interest, then to interest, then to principal.</li>
<li>The borrower may pay any amount on any day. On reducing and daily-interest loans this lowers the interest charged.</li>
<li>Reminders and collection calls are made only between ${org?.callWindowStart}:00 and ${org?.callWindowEnd}:00, on the channels the borrower has agreed to: ${b?.consentChannels.join(', ') || 'none'}.</li>
<li>${p?.assetType === 'GOLD' ? 'If the loan stays unpaid after maturity and written notice, the pledged gold may be sold by public auction. Any surplus after dues is returned to the borrower.' : 'If the loan is not repaid, the lender may enforce the security as permitted by law.'}</li>
<li>The borrower can see the balance, schedule and receipts at any time in the FinX app.</li></ol>
<p style="margin-top:48px">Borrower signature: ____________________ &nbsp;&nbsp; For ${org?.name}: ____________________</p>
</body></html>`;
  return saveDoc(ctx, { ownerType: 'LOAN', ownerId: loanId, kind: 'AGREEMENT', filename: `agreement-${fmtNo.loan(loan.loanNo)}.html`, mime: 'text/html', data: Buffer.from(html) });
}
