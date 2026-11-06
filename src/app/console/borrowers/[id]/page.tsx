import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireCtx } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { PageHeader, Card, Badge, KV, M, Dpd } from '@/components/ui';
import { ActionForm, Field, Select, Drawer } from '@/components/form';
import { fmtNo } from '@/server/core';
import { fmtDate } from '@/lib/dates';
import { LANGUAGES } from '@/server/agent';
import * as act from '../../actions';

export const metadata = { title: 'Borrower' };

export default async function BorrowerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const T = schema;
  const b = await db.query.borrowers.findFirst({ where: and(eq(T.borrowers.id, id), eq(T.borrowers.orgId, ctx.orgId)) });
  if (!b) notFound();
  const [loans, docs, comms] = await Promise.all([
    db.select({ id: T.loans.id, loanNo: T.loans.loanNo, status: T.loans.status, principal: T.loans.principal, out: T.loans.outstandingPrincipal, dpd: T.loans.dpd, product: T.products.name, start: T.loans.startDate })
      .from(T.loans).innerJoin(T.products, eq(T.products.id, T.loans.productId)).where(eq(T.loans.borrowerId, id)).orderBy(desc(T.loans.loanNo)),
    db.select().from(T.documents).where(and(eq(T.documents.ownerType, 'BORROWER'), eq(T.documents.ownerId, id))),
    db.select().from(T.communications).where(eq(T.communications.borrowerId, id)).orderBy(desc(T.communications.createdAt)).limit(10),
  ]);
  const w = can(ctx.role, 'borrower.write');
  return (
    <>
      <PageHeader back={{ href: '/console/borrowers', label: 'Borrowers' }} title={<span className="flex items-center gap-3">{b.name} <Badge v={b.kycStatus} label={`KYC ${b.kycStatus.toLowerCase()}`} /></span>}
        sub={`${fmtNo.borrower(b.code)} · ${b.phone} · ${LANGUAGES[b.language] ?? b.language} · repayment score ${b.repaymentScore}`}
        actions={<Link href={`/console/loans/new?borrower=${b.id}`} className="btn-primary">New loan</Link>} />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card title="Loans" pad={false}>
            {loans.length === 0 ? <p className="p-5 text-sm text-dim">No loans yet.</p> : (
              <table className="w-full"><thead><tr><th className="th">Loan</th><th className="th">Product</th><th className="th">Disbursed</th><th className="th text-right">Amount</th><th className="th text-right">Outstanding</th><th className="th">Status</th></tr></thead>
                <tbody>{loans.map((l) => (
                  <tr key={l.id} className="tr"><td className="td"><Link className="text-brand" href={`/console/loans/${l.id}`}>{fmtNo.loan(l.loanNo)}</Link></td><td className="td text-dim">{l.product}</td><td className="td num text-dim">{fmtDate(l.start)}</td>
                    <td className="td text-right"><M v={l.principal} /></td><td className="td text-right"><M v={l.out} /></td><td className="td">{l.status === 'ACTIVE' ? <Dpd d={l.dpd} /> : <Badge v={l.status} />}</td></tr>
                ))}</tbody></table>
            )}
          </Card>
          {w && (
            <Card title="Edit details">
              <ActionForm action={act.updateBorrowerAction.bind(null, id) as never} className="grid gap-3 sm:grid-cols-3" submit="Save changes">
                <Field label="Name" name="name" defaultValue={b.name} />
                <Field label="Mobile" name="phone" defaultValue={b.phone} />
                <Field label="Email" name="email" defaultValue={b.email} />
                <Field label="Address" name="address" defaultValue={b.address} className="sm:col-span-2" />
                <Field label="PIN" name="pincode" defaultValue={b.pincode} />
                <Select label="Language" name="language" options={Object.entries(LANGUAGES)} defaultValue={b.language} />
                <Field label="PAN" name="pan" defaultValue={b.pan} />
                <Field label="Occupation" name="occupation" defaultValue={b.occupation} />
                <input type="hidden" name="consentForm" value="1" />
                <div className="sm:col-span-3 flex flex-wrap gap-4 text-sm"><span className="text-mute">Consent:</span>
                  {[['VOICE', 'Calls'], ['WHATSAPP', 'WhatsApp'], ['SMS', 'SMS'], ['EMAIL', 'Email']].map(([v, l]) => <label key={v} className="flex items-center gap-2"><input type="checkbox" name="consent" value={v} defaultChecked={b.consentChannels.includes(v)} />{l}</label>)}
                </div>
              </ActionForm>
            </Card>
          )}
          <Card title="Recent contact">
            {comms.length === 0 ? <p className="text-sm text-dim">None.</p> : <ul className="space-y-2 text-sm">{comms.map((c) => <li key={c.id} className="flex gap-3"><span className="w-24 shrink-0 text-xs text-mute">{c.createdAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' })} · {c.channel}</span><span className="text-dim">{c.content.slice(0, 140)}</span></li>)}</ul>}
          </Card>
        </div>
        <aside className="space-y-4">
          <Card title="KYC">
            <KV rows={[['PAN', b.pan], ['Aadhaar', b.aadhaarLast4 ? `XXXX XXXX ${b.aadhaarLast4}` : null], ['CKYC', b.ckycNo], ['Verified', fmtDate(b.kycVerifiedAt)], ['Re-verify by', fmtDate(b.kycDueAt)], ['Consent given', fmtDate(b.consentAt)], ['Channels', b.consentChannels.join(', ') || 'None']]} />
            {w && b.kycStatus !== 'VERIFIED' && <div className="mt-4 flex gap-2"><ActionForm action={act.verifyKycAction.bind(null, id, true) as never} submit="Mark KYC verified" /><ActionForm action={act.verifyKycAction.bind(null, id, false) as never} submit="Reject" submitClass="btn-danger" /></div>}
          </Card>
          <Card title="Documents">
            <ul className="mb-3 space-y-2 text-sm">{docs.length === 0 && <li className="text-dim">No KYC documents uploaded.</li>}{docs.map((x) => <li key={x.id} className="flex justify-between"><a className="text-brand" target="_blank" href={`/api/documents/${x.id}`}>{x.filename}</a><span className="text-xs text-mute">{x.kind.toLowerCase()}</span></li>)}</ul>
            {w && <Drawer label="Upload KYC document"><ActionForm action={act.uploadDocAction.bind(null, 'BORROWER', id) as never} className="space-y-2" submit="Upload" reset>
              <input type="file" name="file" accept="image/*,application/pdf" capture="environment" className="block w-full text-xs text-dim" />
              <select name="kind" className="input"><option value="KYC">PAN / Aadhaar / ID</option><option value="PHOTO">Photo</option><option value="ADDRESS_PROOF">Address proof</option></select>
            </ActionForm></Drawer>}
          </Card>
          <Card title="Profile"><KV rows={[['Father / spouse', b.fatherName], ['Date of birth', fmtDate(b.dob)], ['Occupation', b.occupation], ['Income', b.monthlyIncome ? `₹${Number(b.monthlyIncome).toLocaleString('en-IN')} / month` : null], ['Address', [b.address, b.city, b.pincode].filter(Boolean).join(', ')]]} /></Card>
        </aside>
      </div>
    </>
  );
}
