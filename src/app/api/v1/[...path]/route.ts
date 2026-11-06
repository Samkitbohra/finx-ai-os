// REST API for integrations (payment gateways, accounting tools, field apps). Auth: Authorization: Bearer <api key>.
//   GET  /api/v1/borrowers?phone=9840012345
//   GET  /api/v1/loans?status=ACTIVE&overdue=1
//   GET  /api/v1/loans/{loanNo}
//   GET  /api/v1/loans/{loanNo}/dues
//   POST /api/v1/loans/{loanNo}/payments   { amount, mode: "UPI"|"NEFT"|"CASH"|"CHEQUE", reference, date? }
import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { Ctx } from '@/lib/auth';
import { hashKey } from '@/server/admin';
import { listLoans } from '@/server/reports';
import { findLoanByNo, getDues, recordPayment } from '@/server/loans';
import { fmtNo } from '@/server/core';

async function auth(req: Request): Promise<Ctx | null> {
  const key = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!key) return null;
  const k = await db.query.apiKeys.findFirst({ where: and(eq(schema.apiKeys.hash, hashKey(key)), eq(schema.apiKeys.revoked, false)) });
  if (!k) return null;
  await db.update(schema.apiKeys).set({ lastUsed: new Date() }).where(eq(schema.apiKeys.id, k.id));
  return { orgId: k.orgId, userId: null, role: 'ADMIN', branchId: null, name: `API: ${k.name}`, via: 'API' };
}
const err = (status: number, error: string) => NextResponse.json({ error }, { status });
const money = (p: number) => p / 100;

async function handle(req: Request, path: string[]) {
  const ctx = await auth(req);
  if (!ctx) return err(401, 'Missing or invalid API key');
  const u = new URL(req.url).searchParams;
  try {
    if (req.method === 'GET' && path[0] === 'borrowers' && !path[1]) {
      const phone = (u.get('phone') ?? '').replace(/\D/g, '').slice(-10);
      const rows = await db.select().from(schema.borrowers).where(and(eq(schema.borrowers.orgId, ctx.orgId), phone ? sql`right(regexp_replace(${schema.borrowers.phone}, '\\D', '', 'g'), 10) = ${phone}` : undefined)).limit(100);
      return NextResponse.json({ data: rows.map((b) => ({ id: b.id, code: fmtNo.borrower(b.code), name: b.name, phone: b.phone, kyc: b.kycStatus, repaymentScore: b.repaymentScore })) });
    }
    if (req.method === 'GET' && path[0] === 'loans' && !path[1]) {
      const rows = await listLoans(ctx, { status: u.get('status') ?? 'ACTIVE', dpdMin: u.get('overdue') ? 1 : undefined, limit: 1000 });
      return NextResponse.json({ data: rows.map((l) => ({ loanNo: l.loanNo, borrower: l.borrowerName, phone: l.phone, product: l.product, status: l.status, principal: Number(l.principal), outstanding: Number(l.outstanding), daysPastDue: l.dpd, maturity: l.maturityDate })) });
    }
    if (path[0] === 'loans' && path[1]) {
      const loan = await findLoanByNo(ctx, Number(path[1]));
      if (req.method === 'GET' && !path[2]) return NextResponse.json({ data: { loanNo: loan.loanNo, status: loan.status, principal: Number(loan.principal), outstanding: Number(loan.outstandingPrincipal), rate: Number(loan.annualRate), method: loan.interestMethod, tenure: loan.tenure, startDate: loan.startDate, maturityDate: loan.maturityDate, daysPastDue: loan.dpd } });
      if (req.method === 'GET' && path[2] === 'dues') { const d = await getDues(ctx, loan.id); return NextResponse.json({ data: d && { asOf: d.asOf, penalty: money(d.penalty), interest: money(d.interest), principalOverdue: money(d.principalOverdue), dueNow: money(d.dueNow), payoff: money(d.payoff), daysPastDue: d.dpd, nextDue: d.nextDue && { date: d.nextDue.date, amount: money(d.nextDue.amount) } } }); }
      if (req.method === 'POST' && path[2] === 'payments') {
        const body = await req.json();
        if (body.reference) {
          const dup = await db.query.payments.findFirst({ where: and(eq(schema.payments.loanId, loan.id), eq(schema.payments.reference, String(body.reference)), eq(schema.payments.reversed, false)) });
          if (dup) return NextResponse.json({ data: { receipt: fmtNo.receipt(dup.receiptNo), duplicate: true } });
        }
        const r = await recordPayment(ctx, loan.id, { amount: body.amount, mode: body.mode ?? 'UPI', reference: body.reference, date: body.date });
        return NextResponse.json({ data: { receipt: fmtNo.receipt(r.payment.receiptNo), toPenalty: money(r.allocation.toPenalty), toInterest: money(r.allocation.toInterest), toPrincipal: money(r.allocation.toPrincipal), outstanding: Number(r.loan.outstandingPrincipal), closed: r.allocation.closed } }, { status: 201 });
      }
    }
    return err(404, 'Unknown endpoint');
  } catch (e) {
    return err((e as { status?: number }).status ?? 400, (e as Error).message);
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) { return handle(req, (await params).path); }
export async function POST(req: Request, { params }: { params: Promise<{ path: string[] }> }) { return handle(req, (await params).path); }
