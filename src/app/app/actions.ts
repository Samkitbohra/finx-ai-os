'use server';
import { redirect } from 'next/navigation';
import { requestOtp, verifyOtp, reportPayment } from '@/server/borrower-app';
import { setBorrowerCookie, getBorrowerId, clearBorrower } from '@/lib/auth';

type R = { error?: string; sent?: boolean; phone?: string; demoCode?: string; ok?: boolean } | undefined;

export async function otpAction(prev: R, f: FormData): Promise<R> {
  const phone = String(f.get('phone') ?? '');
  const code = String(f.get('code') ?? '');
  if (!code) {
    const r = await requestOtp(phone);
    if ('error' in r) return { error: r.error };
    return { sent: true, phone, demoCode: r.demoCode };
  }
  const b = await verifyOtp(phone, code);
  if (!b) return { ...prev, error: 'That code is wrong or has expired.' };
  await setBorrowerCookie(b.id);
  redirect('/app');
}

export async function reportPaymentAction(loanId: string, _: R, f: FormData): Promise<R> {
  const bid = await getBorrowerId();
  if (!bid) redirect('/app/login');
  const r = await reportPayment(bid, loanId, Number(f.get('amount')), String(f.get('utr') ?? ''));
  return 'error' in r ? { error: r.error } : { ok: true };
}

export async function signOutAction() { await clearBorrower(); redirect('/app/login'); }
