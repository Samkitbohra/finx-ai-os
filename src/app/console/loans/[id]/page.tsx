import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCtx } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { loanDetail } from '@/server/reports';
import { getDues } from '@/server/loans';
import { fmtNo } from '@/server/core';
import { fmtP, toPaise } from '@/lib/money';
import { fmtDate, todayIST } from '@/lib/dates';
import { PageHeader, Card, Badge, Dpd, M, KV, Stat, ASSET_LABEL, METHOD_LABEL, FREQ_LABEL, TENURE_UNIT } from '@/components/ui';
import { ActionForm, Field, Select, Drawer } from '@/components/form';
import { DisburseForm, SignaturePad } from '@/components/loan-client';
import * as act from '../../actions';

export const metadata = { title: 'Loan' };
const CH: [string, string][] = [['WHATSAPP', 'WhatsApp'], ['VOICE', 'AI voice call'], ['SMS', 'SMS'], ['EMAIL', 'Email']];
const TPL: [string, string][] = [['DUE_REMINDER', 'Due reminder'], ['OVERDUE', 'Overdue follow-up'], ['STATEMENT', 'Statement'], ['AUCTION_NOTICE', 'Auction notice (gold)']];

export default async function LoanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const d = await loanDetail(ctx, id);
  if (!d) notFound();
  const { loan, borrower: b, product: p } = d;
  const dues = loan.startDate ? await getDues(ctx, id) : null;
  const P = toPaise(loan.principal);
  const fee = Math.round((P * Number(p.processingFeePct)) / 100);
  const net = P - fee - Math.round((fee * Number(p.gstRate)) / 100);
  const lastLive = d.payments.find((x) => !x.reversed);
  const totalInterest = d.installments.reduce((a, r) => a + toPaise(r.interestDue), 0);

  return (
    <>
      <PageHeader back={{ href: '/console/loans', label: 'Loans' }}
        title={<span className="flex flex-wrap items-center gap-3">{b.name} <span className="text-dim">· Loan {fmtNo.loan(loan.loanNo)}</span> <Badge v={loan.status} />{loan.status === 'ACTIVE' && <Dpd d={dues?.dpd ?? loan.dpd} />}</span>}
        sub={<>{p.name} · {ASSET_LABEL[p.assetType]} · {Number(loan.annualRate)}% {METHOD_LABEL[loan.interestMethod].toLowerCase()} · {d.branch.name} branch · <Link className="text-brand" href={`/console/borrowers/${b.id}`}>{fmtNo.borrower(b.code)}</Link></>}
        actions={<>
          {d.documents.find((x) => x.kind === 'AGREEMENT') ? <a className="btn-ghost" href={`/api/documents/${d.documents.find((x) => x.kind === 'AGREEMENT')!.id}`} target="_blank">Agreement</a>
            : can(ctx.role, 'loan.create') ? <ActionForm action={act.agreementAction.bind(null, id) as never} submit="Generate agreement" submitClass="btn-ghost" /> : null}
          <Link className="btn-ghost" href={`/console/ai?q=${encodeURIComponent(`Summarise loan ${loan.loanNo}`)}`}>Ask FinX AI</Link>
        </>} />

      {loan.status === 'ACTIVE' && dues && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Outstanding principal" value={fmtP(toPaise(loan.outstandingPrincipal))} hint={`of ${fmtP(P)} lent`} />
          <Stat label="Due now" value={fmtP(dues.dueNow)} tone={dues.dueNow > 0 ? 'warn' : 'good'} hint={dues.dueNow ? `Penalty ${fmtP(dues.penalty)} · interest ${fmtP(dues.interest)} · principal ${fmtP(dues.principalOverdue)}` : 'Nothing overdue'} />
          <Stat label="Next due" value={dues.nextDue ? fmtP(dues.nextDue.amount) : '—'} hint={dues.nextDue ? fmtDate(dues.nextDue.date) : 'Final instalment reached'} />
          <Stat label="To close today" value={fmtP(dues.payoff)} hint={loan.interestMethod === 'DAILY' ? `Interest paid to ${fmtDate(loan.interestPaidTo)}` : 'No charge for paying early'} />
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {/* actions by state */}
          {loan.status === 'PENDING_APPROVAL' && can(ctx.role, 'loan.approve') && (
            <Card title="Approval">
              <p className="mb-3 text-sm text-dim">Check KYC ({b.kycStatus.toLowerCase()}), collateral and LTV{loan.ltvAtSanction ? ` (${Number(loan.ltvAtSanction)}%)` : ''} before approving. The officer who created the loan cannot approve it.</p>
              <div className="flex flex-wrap gap-3">
                <ActionForm action={act.approveAction.bind(null, id, true) as never} className="flex gap-2"><input name="reason" className="input" placeholder="Note (optional)" /><button className="btn-primary">Approve</button></ActionForm>
                <ActionForm action={act.approveAction.bind(null, id, false) as never} className="flex gap-2" confirm="Reject this loan?"><input name="reason" className="input" placeholder="Reason" required /><button className="btn-danger">Reject</button></ActionForm>
              </div>
            </Card>
          )}
          {loan.status === 'APPROVED' && can(ctx.role, 'loan.disburse') && (
            <Card title="Disburse">
              {b.kycStatus !== 'VERIFIED' ? <p className="text-sm text-warn">Verify the borrower’s KYC first. <Link href={`/console/borrowers/${b.id}`} className="text-brand">Open borrower →</Link></p>
                : <DisburseForm action={act.disburseAction.bind(null, id) as never} net={fmtP(net)} today={todayIST()} />}
            </Card>
          )}
          {loan.status === 'ACTIVE' && can(ctx.role, 'payment.record') && (
            <Card title="Take a payment">
              <ActionForm action={act.paymentAction.bind(null, id) as never} className="grid gap-3 sm:grid-cols-4" reset>
                <Field label="Amount (₹)" name="amount" type="number" step="0.01" min="1" required defaultValue={dues?.dueNow ? (dues.dueNow / 100).toFixed(2) : dues?.nextDue ? (dues.nextDue.amount / 100).toFixed(2) : ''} />
                <Select label="Mode" name="mode" options={[['CASH', 'Cash'], ['UPI', 'UPI'], ['NEFT', 'NEFT / IMPS'], ['CHEQUE', 'Cheque']]} />
                <Field label="Reference" name="reference" placeholder="UTR / cheque" />
                <Field label="Date" name="date" type="date" defaultValue={todayIST()} max={todayIST()} />
                <label className="flex items-center gap-2 text-sm text-dim sm:col-span-3"><input type="checkbox" name="sendReceipt" defaultChecked /> Send the receipt to the borrower</label>
                <div className="sm:col-span-1 sm:text-right"><button className="btn-primary w-full">Record payment</button></div>
              </ActionForm>
              <p className="mt-3 text-xs text-mute">Applied to penal interest first, then interest, then principal. {loan.interestMethod !== 'FLAT' ? 'Anything extra reduces the principal and the interest after it.' : 'Anything extra pays the next instalments in advance.'}</p>
            </Card>
          )}

          <Card title="Repayment schedule" pad={false} actions={<span className="text-xs text-mute">{loan.tenure} {TENURE_UNIT[loan.frequency]} · total interest {fmtP(totalInterest)}</span>}>
            {d.installments.length === 0 ? <p className="p-5 text-sm text-dim">The schedule is created when the loan is disbursed.</p> : (
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full min-w-[620px]">
                  <thead className="sticky top-0 bg-panel"><tr><th className="th">#</th><th className="th">Due</th><th className="th text-right">Principal</th><th className="th text-right">Interest</th><th className="th text-right">Paid</th><th className="th">Status</th></tr></thead>
                  <tbody>{d.installments.map((r) => {
                    const late = r.status !== 'PAID' && r.dueDate < todayIST();
                    return (
                      <tr key={r.id} className="tr">
                        <td className="td num text-mute">{r.seq}</td>
                        <td className={`td num ${late ? 'text-bad' : ''}`}>{fmtDate(r.dueDate)}</td>
                        <td className="td text-right"><M v={r.principalDue} /></td>
                        <td className="td text-right"><M v={r.interestDue} /></td>
                        <td className="td text-right text-dim"><M v={toPaise(r.principalPaid) / 100 + toPaise(r.interestPaid) / 100} /></td>
                        <td className="td"><Badge v={late && r.status !== 'PARTIAL' ? 'FAILED' : r.status} label={late ? (r.status === 'PARTIAL' ? 'Part paid, late' : 'Late') : undefined} /></td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Payments" pad={false}>
            {d.payments.length === 0 ? <p className="p-5 text-sm text-dim">No payments yet.</p> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[640px]">
                <thead><tr><th className="th">Receipt</th><th className="th">Date</th><th className="th">Mode</th><th className="th text-right">Amount</th><th className="th text-right">Penalty</th><th className="th text-right">Interest</th><th className="th text-right">Principal</th><th className="th" /></tr></thead>
                <tbody>{d.payments.map((x) => (
                  <tr key={x.id} className={`tr ${x.reversed ? 'opacity-50 line-through' : ''}`}>
                    <td className="td num">{fmtNo.receipt(x.receiptNo)}</td>
                    <td className="td num text-dim">{x.receivedAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}</td>
                    <td className="td text-dim">{x.mode}{x.via !== 'UI' ? <span className="ml-1 text-xs text-mute">· {x.via.toLowerCase().replace('_', ' ')}</span> : null}</td>
                    <td className="td text-right font-medium"><M v={x.amount} /></td>
                    <td className="td text-right text-dim"><M v={x.toPenalty} /></td>
                    <td className="td text-right text-dim"><M v={x.toInterest} /></td>
                    <td className="td text-right text-dim"><M v={x.toPrincipal} /></td>
                    <td className="td text-right">{x.id === lastLive?.id && can(ctx.role, 'payment.reverse') && (
                      <ActionForm action={act.reversePaymentAction.bind(null, id, x.id) as never} className="flex justify-end gap-2" confirm="Reverse this receipt? The loan will be rebuilt and a reversal posted to the books.">
                        <input name="reason" className="input h-8 w-36 py-1 text-xs" placeholder="Reason" required /><button className="btn-danger px-2 py-1 text-xs">Reverse</button>
                      </ActionForm>)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </Card>

          <Card title="Contact timeline" actions={loan.status === 'ACTIVE' && can(ctx.role, 'comms.send') ? <span className="text-xs text-mute">Calls only inside permitted hours</span> : null}>
            {loan.status === 'ACTIVE' && can(ctx.role, 'comms.send') && (
              <ActionForm action={act.contactAction.bind(null, id) as never} className="mb-4 flex flex-wrap items-end gap-2">
                <Select label="Channel" name="channel" options={CH} className="w-40" />
                <Select label="Script" name="template" options={TPL} defaultValue={loan.dpd > 0 ? 'OVERDUE' : 'DUE_REMINDER'} className="w-52" />
                <button className="btn-ghost">Contact {b.name.split(' ')[0]}</button>
              </ActionForm>
            )}
            {d.communications.length === 0 ? <p className="text-sm text-dim">No contact yet.</p> : (
              <ol className="space-y-3">{d.communications.map((c) => (
                <li key={c.id} className="rounded-xl border border-line bg-raised/50 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold">{c.direction === 'IN' ? '↙ Reply' : '↗'} {c.channel}</span><Badge v={c.status} />{c.outcome && <Badge v="COMPLETED" label={c.outcome.replace(/_/g, ' ').toLowerCase()} />}
                    <span className="text-mute">{c.language.toUpperCase()} · {c.createdAt.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}{c.provider === 'simulate' ? ' · simulated' : ''}</span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-line text-sm text-dim">{c.content}</p>
                  {c.blockReason && <p className="mt-1 text-xs text-warn">{c.status === 'BLOCKED' ? 'Held back: ' : ''}{c.blockReason}</p>}
                  {c.transcript && <p className="mt-1 text-xs text-mute">Transcript: {c.transcript}</p>}
                  {c.ptpDate && <p className="mt-1 text-xs text-good">Promise to pay {c.ptpAmount ? fmtP(toPaise(c.ptpAmount)) : ''} by {fmtDate(c.ptpDate)}</p>}
                  {c.channel === 'VOICE' && c.status === 'SENT' && (
                    <div className="mt-2"><Drawer label="Log call outcome">
                      <ActionForm action={act.outcomeAction.bind(null, id, c.id) as never} className="grid gap-2 sm:grid-cols-2" submit="Save outcome">
                        <Select label="Outcome" name="outcome" options={[['PROMISE_TO_PAY', 'Promise to pay'], ['NO_ANSWER', 'No answer'], ['CALLBACK', 'Call back'], ['PAID', 'Says paid'], ['DISPUTE', 'Dispute'], ['WRONG_NUMBER', 'Wrong number']]} />
                        <Field label="Promise date" name="ptpDate" type="date" />
                        <Field label="Promise amount (₹)" name="ptpAmount" type="number" />
                        <Field label="Notes / transcript" name="transcript" />
                      </ActionForm>
                    </Drawer></div>
                  )}
                </li>
              ))}</ol>
            )}
          </Card>
        </div>

        <aside className="space-y-4">
          <Card title="Terms">
            <KV rows={[
              ['Amount', fmtP(P)], ['Rate', `${Number(loan.annualRate)}% a year`], ['Method', METHOD_LABEL[loan.interestMethod]], ['Repayment', FREQ_LABEL[loan.frequency]],
              ['Tenure', `${loan.tenure} ${TENURE_UNIT[loan.frequency]}`], ['Penal rate', `${Number(loan.penalRate)}% after ${p.graceDays} days`], ['Disbursed', fmtDate(loan.startDate)],
              ['Maturity', fmtDate(loan.maturityDate)], ['Processing fee', fmtP(toPaise(loan.processingFee))], ['Interest paid', fmtP(toPaise(loan.totalInterestPaid))],
              ['Officer', d.officer?.name], ['Approved by', d.approver ? `${d.approver.name}` : '—'], ['Purpose', loan.purpose],
            ]} />
          </Card>
          <Card title="Collateral">
            {d.collaterals.length === 0 ? <p className="text-sm text-dim">Unsecured.</p> : d.collaterals.map((c) => (
              <div key={c.id} className="space-y-2">
                <div className="flex items-center justify-between"><span className="font-medium">{c.description}</span><Badge v={c.status} /></div>
                <KV rows={[...Object.entries(c.details).map(([k, v]) => [k.replace(/([A-Z])/g, ' $1').replace(/^\w/, (x) => x.toUpperCase()), Array.isArray(v) ? v.join(', ') : String(v)] as [string, string]),
                  ['Value', fmtP(toPaise(c.value))], ['LTV at sanction', loan.ltvAtSanction ? `${Number(loan.ltvAtSanction)}%` : '—'], ['Packet', c.packetNo]]} />
              </div>
            ))}
          </Card>
          <Card title="Borrower">
            <KV rows={[['Name', <Link key="n" className="text-brand" href={`/console/borrowers/${b.id}`}>{b.name}</Link>], ['Phone', b.phone], ['Language', b.language.toUpperCase()], ['KYC', <Badge key="k" v={b.kycStatus} />], ['Repayment score', `${b.repaymentScore}`], ['Consent', b.consentChannels.join(', ') || 'None']]} />
          </Card>
          <Card title="Documents">
            <ul className="mb-3 space-y-2 text-sm">
              {d.documents.length === 0 && <li className="text-dim">None yet.</li>}
              {d.documents.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-2">
                  <a href={`/api/documents/${x.id}`} target="_blank" className="truncate text-brand">{x.filename}</a>
                  <span className="shrink-0 text-xs text-mute">{x.signed ? `Signed · ${x.signerName}` : x.kind.toLowerCase()}</span>
                </li>
              ))}
            </ul>
            {can(ctx.role, 'borrower.write') && <ActionForm action={act.uploadDocAction.bind(null, 'LOAN', id) as never} className="space-y-2" submit="Upload" submitClass="btn-ghost" reset>
              <input type="file" name="file" className="block w-full text-xs text-dim file:mr-3 file:rounded-lg file:border-0 file:bg-raised file:px-3 file:py-1.5 file:text-ink" />
              <select name="kind" className="input"><option value="VALUATION">Valuation report</option><option value="PHOTO">Collateral photo</option><option value="NOTICE">Notice</option><option value="OTHER">Other</option></select>
            </ActionForm>}
            {can(ctx.role, 'loan.create') && d.documents.filter((x) => x.kind === 'AGREEMENT' && !x.signed).map((x) => (
              <div key={x.id} className="mt-4"><Drawer label="Counter-sign agreement">
                <ActionForm action={act.signDocAction.bind(null, x.id, `/console/loans/${id}`) as never} className="space-y-2" submit="Sign and seal">
                  <Field label="Signer name" name="signerName" defaultValue={b.name} required />
                  <SignaturePad />
                </ActionForm>
              </Drawer></div>
            ))}
          </Card>
          {d.invoices.length > 0 && (
            <Card title="Invoices">
              <ul className="space-y-2 text-sm">{d.invoices.map((i) => (
                <li key={i.id} className="flex justify-between"><span>{fmtNo.invoice(i.invoiceNo)} <span className="text-mute">· GST {Number(i.gstRate)}%</span></span><span className="flex items-center gap-2"><M v={i.total} /><Badge v={i.status} /></span></li>
              ))}</ul>
            </Card>
          )}
          {loan.status === 'ACTIVE' && can(ctx.role, 'loan.writeoff') && (
            <Card title="Recovery">
              <div className="space-y-3">
                {p.assetType === 'GOLD' && (
                  <Drawer label="Record auction sale" tone="danger">
                    <ActionForm action={act.auctionAction.bind(null, id) as never} className="space-y-2" submit="Record auction" submitClass="btn-danger" confirm="Record the auction? Dues are cleared from the proceeds, any surplus is owed to the borrower.">
                      <Field label="Sale proceeds (₹)" name="sale" type="number" required />
                      <Select label="Received by" name="mode" options={[['NEFT', 'NEFT'], ['CASH', 'Cash'], ['UPI', 'UPI']]} />
                    </ActionForm>
                  </Drawer>
                )}
                <Drawer label="Write off" tone="danger">
                  <ActionForm action={act.writeOffAction.bind(null, id) as never} className="space-y-2" submit="Write off" submitClass="btn-danger" confirm="Write this loan off? The outstanding is moved to bad debts.">
                    <Field label="Reason" name="reason" required />
                  </ActionForm>
                </Drawer>
              </div>
            </Card>
          )}
          <Card title="History">
            <ol className="space-y-2.5 text-sm">{d.history.map((h) => (
              <li key={h.id}><div className="text-dim">{h.summary}</div><div className="text-xs text-mute">{h.at.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} · {h.via.toLowerCase()}</div></li>
            ))}</ol>
          </Card>
        </aside>
      </div>
    </>
  );
}
