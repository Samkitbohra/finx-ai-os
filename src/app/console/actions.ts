'use server';
// Server actions for the console. Each wraps a service call, turns errors into a message, and refreshes the page.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ZodError } from 'zod';
import { requireCtx } from '@/lib/auth';
import * as L from '@/server/loans';
import * as A from '@/server/agent';
import * as ACC from '@/server/accounting';
import * as DOC from '@/server/documents';
import * as ADM from '@/server/admin';
import * as CMP from '@/server/compliance';

export type Result = { error?: string; ok?: string; id?: string } | undefined;

const msg = (e: unknown) => e instanceof ZodError ? e.issues.map((i) => `${i.path.join('.') || 'Input'}: ${i.message}`).join(' · ') : (e as Error)?.message ?? 'Something went wrong';
const num = (f: FormData, k: string) => { const v = f.get(k); return v === null || v === '' ? undefined : Number(v); };
const str = (f: FormData, k: string) => { const v = f.get(k); return v === null ? undefined : String(v).trim(); };

async function run(fn: () => Promise<Result | void>, paths: string[] = []): Promise<Result> {
  try {
    const r = await fn();
    for (const p of paths) revalidatePath(p);
    return r ?? { ok: 'Saved' };
  } catch (e) {
    if ((e as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw e;
    return { error: msg(e) };
  }
}

// ---------------------------------------------------------------- borrowers
export async function createBorrowerAction(_: Result, f: FormData): Promise<Result> {
  let id = '';
  const r = await run(async () => {
    const ctx = await requireCtx('borrower.write');
    const b = await L.createBorrower(ctx, {
      branchId: str(f, 'branchId'), name: str(f, 'name')!, fatherName: str(f, 'fatherName'), dob: str(f, 'dob') || null, gender: str(f, 'gender'),
      phone: str(f, 'phone')!, altPhone: str(f, 'altPhone'), email: str(f, 'email') ?? '', address: str(f, 'address'), city: str(f, 'city'), state: str(f, 'state'),
      pincode: str(f, 'pincode'), language: str(f, 'language') ?? 'en', occupation: str(f, 'occupation'), monthlyIncome: num(f, 'monthlyIncome'),
      pan: str(f, 'pan') ?? '', aadhaarLast4: str(f, 'aadhaarLast4') ?? '', ckycNo: str(f, 'ckycNo'),
      consentChannels: f.getAll('consent').map(String) as ('VOICE' | 'WHATSAPP' | 'EMAIL' | 'SMS')[],
    });
    id = b.id;
  }, ['/console/borrowers']);
  if (r?.error) return r;
  redirect(`/console/borrowers/${id}`);
}

export async function updateBorrowerAction(id: string, _: Result, f: FormData): Promise<Result> {
  return run(async () => {
    const ctx = await requireCtx('borrower.write');
    const patch: Record<string, unknown> = {};
    for (const k of ['name', 'phone', 'altPhone', 'email', 'address', 'city', 'pincode', 'language', 'occupation', 'pan', 'aadhaarLast4', 'ckycNo']) { const v = str(f, k); if (v !== undefined) patch[k] = v; }
    if (f.has('consentForm')) patch.consentChannels = f.getAll('consent').map(String);
    if (f.has('monthlyIncome')) patch.monthlyIncome = num(f, 'monthlyIncome');
    await L.updateBorrower(ctx, id, patch);
    return { ok: 'Borrower updated' };
  }, [`/console/borrowers/${id}`]);
}

export async function verifyKycAction(id: string, ok: boolean): Promise<Result> {
  return run(async () => { const ctx = await requireCtx('borrower.write'); await L.verifyKyc(ctx, id, ok); return { ok: ok ? 'KYC verified' : 'KYC rejected' }; }, [`/console/borrowers/${id}`]);
}

// ---------------------------------------------------------------- loans
export async function createLoanAction(_: Result, f: FormData): Promise<Result> {
  let id = '';
  const r = await run(async () => {
    const ctx = await requireCtx('loan.create');
    const assetType = str(f, 'assetType');
    const collaterals = assetType && assetType !== 'BUSINESS' && assetType !== 'UNSECURED' && num(f, 'colValue')
      ? [{ assetType: assetType as never, description: str(f, 'colDescription') || assetType, value: num(f, 'colValue')!, valuer: str(f, 'colValuer'), packetNo: str(f, 'colPacket'),
          details: Object.fromEntries([...f.entries()].filter(([k, v]) => k.startsWith('d_') && v !== '').map(([k, v]) => [k.slice(2), isNaN(Number(v)) || k.includes('No') || k.includes('regNo') ? v : Number(v)])) }]
      : [];
    const guarantors = str(f, 'gName') ? [{ name: str(f, 'gName')!, phone: str(f, 'gPhone') ?? '', relation: str(f, 'gRelation') }] : [];
    const loan = await L.createLoan(ctx, {
      borrowerId: str(f, 'borrowerId')!, productId: str(f, 'productId')!, principal: num(f, 'principal')!, tenure: num(f, 'tenure')!,
      annualRate: num(f, 'annualRate'), purpose: str(f, 'purpose'), collaterals, guarantors, notes: str(f, 'notes'),
    });
    id = loan.id;
  }, ['/console/loans', '/console/approvals']);
  if (r?.error) return r;
  redirect(`/console/loans/${id}`);
}

export async function approveAction(id: string, approve: boolean, _: Result, f: FormData): Promise<Result> {
  return run(async () => { const ctx = await requireCtx('loan.approve'); await L.approveLoan(ctx, id, approve, str(f, 'reason')); return { ok: approve ? 'Approved' : 'Rejected' }; }, [`/console/loans/${id}`, '/console/approvals']);
}

export async function disburseAction(id: string, _: Result, f: FormData): Promise<Result> {
  return run(async () => {
    const ctx = await requireCtx('loan.disburse');
    await L.disburseLoan(ctx, id, { mode: str(f, 'mode') as never, reference: str(f, 'reference'), payee: str(f, 'payee'), date: str(f, 'date') || undefined, deductFee: f.get('deductFee') !== 'no' });
    await DOC.generateAgreement(ctx, id).catch(() => null);
    return { ok: 'Disbursed. Schedule created and books posted.' };
  }, [`/console/loans/${id}`, '/console/approvals', '/console']);
}

export async function paymentAction(id: string, _: Result, f: FormData): Promise<Result> {
  return run(async () => {
    const ctx = await requireCtx('payment.record');
    const r = await L.recordPayment(ctx, id, { amount: num(f, 'amount')!, mode: str(f, 'mode') as never, reference: str(f, 'reference'), date: str(f, 'date') || undefined });
    if (f.get('sendReceipt') === 'on') await A.contactBorrower(ctx, id, 'WHATSAPP', 'RECEIPT', { extra: { amount: `₹${Number(r.payment.amount).toLocaleString('en-IN')}`, receiptNo: `R-${String(r.payment.receiptNo).padStart(5, '0')}` } }).catch(() => null);
    return { ok: `Receipt R-${String(r.payment.receiptNo).padStart(5, '0')} recorded${r.allocation.closed ? ' · loan closed and collateral released' : ''}` };
  }, [`/console/loans/${id}`, '/console']);
}

export async function reversePaymentAction(loanId: string, paymentId: string, _: Result, f: FormData): Promise<Result> {
  return run(async () => { const ctx = await requireCtx('payment.reverse'); await L.reversePayment(ctx, paymentId, str(f, 'reason') ?? ''); return { ok: 'Receipt reversed and loan rebuilt' }; }, [`/console/loans/${loanId}`]);
}

export async function writeOffAction(id: string, _: Result, f: FormData): Promise<Result> {
  return run(async () => { const ctx = await requireCtx('loan.writeoff'); await L.writeOffLoan(ctx, id, str(f, 'reason') ?? 'Unrecoverable'); return { ok: 'Written off' }; }, [`/console/loans/${id}`]);
}

export async function auctionAction(id: string, _: Result, f: FormData): Promise<Result> {
  return run(async () => { const ctx = await requireCtx('loan.writeoff'); await L.auctionLoan(ctx, id, num(f, 'sale')!, (str(f, 'mode') as never) ?? 'NEFT'); return { ok: 'Auction recorded' }; }, [`/console/loans/${id}`]);
}

export async function contactAction(id: string, _: Result, f: FormData): Promise<Result> {
  return run(async () => {
    const ctx = await requireCtx('comms.send');
    const r = await A.contactBorrower(ctx, id, str(f, 'channel') as never, str(f, 'template') ?? 'DUE_REMINDER');
    if ('blocked' in r && r.blocked) return { error: `Not sent: ${r.blocked}` };
    return { ok: 'simulated' in r && r.simulated ? 'Logged (simulation mode — connect the channel in Settings to send for real)' : 'Sent' };
  }, [`/console/loans/${id}`]);
}

export async function outcomeAction(loanId: string, commId: string, _: Result, f: FormData): Promise<Result> {
  return run(async () => {
    const ctx = await requireCtx('comms.send');
    await A.logOutcome(ctx, commId, { outcome: str(f, 'outcome') as never, transcript: str(f, 'transcript'), ptpDate: str(f, 'ptpDate') || undefined, ptpAmount: num(f, 'ptpAmount') });
    return { ok: 'Outcome logged' };
  }, [`/console/loans/${loanId}`, '/console/collections']);
}

export async function runCollectionsAction(_: Result, f: FormData): Promise<Result> {
  return run(async () => {
    const ctx = await requireCtx('comms.send');
    const r = await A.runCollections(ctx, { dryRun: f.get('dry') === '1' });
    return { ok: f.get('dry') === '1' ? `${r.planned} contacts planned` : `${r.sent} sent · ${r.blocked} held back by contact rules` };
  }, ['/console/collections']);
}

export async function reissueInvoiceAction(_: Result, f: FormData): Promise<Result> {
  return run(async () => { const ctx = await requireCtx('invoice.write'); const inv = await L.reissueInvoice(ctx, num(f, 'invoiceNo')!, num(f, 'gstRate')!); return { ok: `Re-issued as INV-${String(inv.invoiceNo).padStart(5, '0')}` }; }, ['/console/accounting']);
}

// ---------------------------------------------------------------- accounting
export async function journalAction(_: Result, f: FormData): Promise<Result> {
  return run(async () => {
    const ctx = await requireCtx('journal.write');
    const lines = [0, 1, 2, 3].map((i) => ({ account: str(f, `acc${i}`), debit: num(f, `dr${i}`), credit: num(f, `cr${i}`) })).filter((l) => l.account);
    await ACC.manualJournal(ctx, { date: str(f, 'date')!, narration: str(f, 'narration')!, lines: lines as never, tdsPct: num(f, 'tdsPct') });
    return { ok: 'Journal posted' };
  }, ['/console/accounting']);
}

// ---------------------------------------------------------------- documents
export async function uploadDocAction(ownerType: string, ownerId: string, _: Result, f: FormData): Promise<Result> {
  return run(async () => {
    const ctx = await requireCtx('borrower.write');
    const file = f.get('file') as File | null;
    if (!file || !file.size) return { error: 'Choose a file' };
    await DOC.saveUpload(ctx, { ownerType, ownerId, kind: str(f, 'kind') ?? 'OTHER', file });
    return { ok: 'Uploaded' };
  }, [ownerType === 'LOAN' ? `/console/loans/${ownerId}` : `/console/borrowers/${ownerId}`]);
}

export async function signDocAction(docId: string, back: string, _: Result, f: FormData): Promise<Result> {
  return run(async () => {
    const ctx = await requireCtx('loan.create');
    await DOC.signDocument(ctx, docId, { signerName: str(f, 'signerName') ?? '', signature: str(f, 'signature') ?? '' });
    return { ok: 'Signed and sealed' };
  }, [back]);
}

export async function agreementAction(loanId: string): Promise<Result> {
  return run(async () => { const ctx = await requireCtx('loan.create'); await DOC.generateAgreement(ctx, loanId); return { ok: 'Agreement generated' }; }, [`/console/loans/${loanId}`]);
}

// ---------------------------------------------------------------- compliance
export async function bureauAction(_: Result, f: FormData): Promise<Result> {
  return run(async () => { const ctx = await requireCtx('compliance.run'); const r = await CMP.generateBureauFile(ctx, str(f, 'bureau') ?? 'CIBIL', str(f, 'periodEnd')); return { ok: `${r.recordCount} records in ${r.filename}` }; }, ['/console/compliance']);
}

// ---------------------------------------------------------------- settings
export async function orgAction(_: Result, f: FormData): Promise<Result> {
  return run(async () => { const ctx = await requireCtx('settings.write'); await ADM.updateOrg(ctx, Object.fromEntries(f.entries()) as Record<string, string>); return { ok: 'Settings saved' }; }, ['/console/settings']);
}
export async function productAction(_: Result, f: FormData): Promise<Result> {
  return run(async () => { const ctx = await requireCtx('settings.write'); await ADM.upsertProduct(ctx, Object.fromEntries(f.entries()) as Record<string, string>); return { ok: 'Product saved' }; }, ['/console/settings']);
}
export async function userAction(_: Result, f: FormData): Promise<Result> {
  return run(async () => { const ctx = await requireCtx('users.write'); await ADM.upsertUser(ctx, Object.fromEntries(f.entries()) as Record<string, string>); return { ok: 'User saved' }; }, ['/console/settings']);
}
export async function branchAction(_: Result, f: FormData): Promise<Result> {
  return run(async () => { const ctx = await requireCtx('settings.write'); await ADM.upsertBranch(ctx, Object.fromEntries(f.entries()) as Record<string, string>); return { ok: 'Branch saved' }; }, ['/console/settings']);
}
export async function templateAction(_: Result, f: FormData): Promise<Result> {
  return run(async () => {
    const ctx = await requireCtx('settings.write');
    if (f.get('translate')) { await A.translateTemplate(ctx, str(f, 'key')!, str(f, 'language')!); return { ok: 'Translated — review and approve' }; }
    await A.saveTemplate(ctx, str(f, 'key')!, str(f, 'language')!, str(f, 'body')!, f.get('approve') === 'on');
    return { ok: 'Script saved' };
  }, ['/console/settings']);
}
export async function apiKeyAction(_: Result, f: FormData): Promise<Result> {
  return run(async () => { const ctx = await requireCtx('settings.write'); const k = await ADM.createApiKey(ctx, str(f, 'name') ?? 'Integration'); return { ok: `Copy this key now — it won't be shown again: ${k}` }; }, ['/console/settings']);
}
export async function targetAction(_: Result, f: FormData): Promise<Result> {
  return run(async () => { const ctx = await requireCtx('settings.write'); await ADM.setTarget(ctx, Object.fromEntries(f.entries()) as Record<string, string>); return { ok: 'Target saved' }; }, ['/console/analytics']);
}
