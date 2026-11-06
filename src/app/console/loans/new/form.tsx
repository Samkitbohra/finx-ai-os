'use client';
import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import { buildSchedule, maxLoanFor, ltvPct } from '@/lib/interest';
import { fmtP } from '@/lib/money';
import { fmtDate, todayIST } from '@/lib/dates';

type Product = { id: string; name: string; assetType: string; method: 'FLAT' | 'REDUCING' | 'DAILY'; frequency: 'MONTHLY' | 'WEEKLY' | 'DAILY' | 'BULLET'; rate: number; min: number; max: number; minTenure: number; maxTenure: number; maxLtv: number | null; tiers: { upTo: number; maxLtv: number }[] | null; fee: number; gst: number };
type R = { error?: string } | undefined;

const UNIT: Record<string, string> = { MONTHLY: 'months', BULLET: 'months', WEEKLY: 'weeks', DAILY: 'days' };
const GOLD_RATE_22K = 6950; // ₹/g — set from the day's board rate

export function NewLoanForm({ action, products, borrowers, defaultBorrower }: { action: (s: R, f: FormData) => Promise<R>; products: Product[]; borrowers: { id: string; code: number; name: string; phone: string; kyc: string }[]; defaultBorrower?: string }) {
  const [state, act, pending] = useActionState(action, undefined);
  const [pid, setPid] = useState(products[0]?.id);
  const p = products.find((x) => x.id === pid)!;
  const [amount, setAmount] = useState(50000);
  const [tenure, setTenure] = useState(p.frequency === 'WEEKLY' ? 20 : 6);
  const [rate, setRate] = useState(p.rate);
  const [colValue, setColValue] = useState(0);
  const [netWt, setNetWt] = useState(0);
  const [karat, setKarat] = useState(22);
  const [goldRate, setGoldRate] = useState(GOLD_RATE_22K);
  const secured = p.maxLtv != null;
  const gold = p.assetType === 'GOLD';
  const value = gold ? Math.round((netWt * goldRate * karat) / 22) : colValue;

  const preview = useMemo(() => {
    try {
      if (!amount || !tenure) return null;
      const rows = buildSchedule({ principal: Math.round(amount * 100), annualRate: rate, method: p.method, frequency: p.frequency, tenure, startDate: todayIST() });
      return { rows, interest: rows.reduce((a, r) => a + r.interestDue, 0), first: rows[0] };
    } catch { return null; }
  }, [amount, tenure, rate, p]);
  const cap = secured && value ? maxLoanFor(value * 100, p.maxLtv, p.tiers) / 100 : null;
  const ltv = secured && value ? ltvPct(amount * 100, value * 100) : null;
  const over = cap != null && amount > cap;
  const fee = (amount * p.fee) / 100;

  return (
    <form action={act} className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <section className="card p-5">
          <h2 className="mb-4 text-sm font-semibold">Borrower and product</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="borrowerId">Borrower <span className="text-bad">*</span></label>
              <select id="borrowerId" name="borrowerId" className="input" defaultValue={defaultBorrower} required>
                <option value="">Choose…</option>
                {borrowers.map((b) => <option key={b.id} value={b.id}>{b.name} · B-{String(b.code).padStart(4, '0')} · {b.phone}{b.kyc !== 'VERIFIED' ? ' (KYC pending)' : ''}</option>)}
              </select>
              <Link href="/console/borrowers/new" className="mt-1 inline-block text-xs text-brand">+ New borrower</Link>
            </div>
            <div>
              <label className="label" htmlFor="productId">Product</label>
              <select id="productId" name="productId" className="input" value={pid} onChange={(e) => { const np = products.find((x) => x.id === e.target.value)!; setPid(np.id); setRate(np.rate); setTenure(Math.min(Math.max(tenure, np.minTenure), np.maxTenure)); }}>
                {products.map((x) => <option key={x.id} value={x.id}>{x.name} — {x.rate}% {x.method.toLowerCase()}</option>)}
              </select>
            </div>
            <div><label className="label" htmlFor="principal">Amount (₹)</label><input id="principal" name="principal" type="number" min={p.min} max={p.max} step="100" className="input" value={amount} onChange={(e) => setAmount(Number(e.target.value))} required /><p className="mt-1 text-xs text-mute">{fmtP(p.min * 100)} – {fmtP(p.max * 100)}</p></div>
            <div><label className="label" htmlFor="tenure">Tenure ({UNIT[p.frequency]})</label><input id="tenure" name="tenure" type="number" min={p.minTenure} max={p.maxTenure} className="input" value={tenure} onChange={(e) => setTenure(Number(e.target.value))} required /><p className="mt-1 text-xs text-mute">{p.minTenure}–{p.maxTenure}</p></div>
            <div><label className="label" htmlFor="annualRate">Rate (% a year)</label><input id="annualRate" name="annualRate" type="number" step="0.01" className="input" value={rate} onChange={(e) => setRate(Number(e.target.value))} /></div>
            <div><label className="label" htmlFor="purpose">Purpose</label><input id="purpose" name="purpose" className="input" placeholder="Business, medical, education…" /></div>
          </div>
        </section>

        {secured && (
          <section className="card p-5">
            <h2 className="mb-4 text-sm font-semibold">Collateral</h2>
            <input type="hidden" name="assetType" value={p.assetType} />
            <input type="hidden" name="colValue" value={value} />
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-3"><label className="label" htmlFor="colDescription">Description</label><input id="colDescription" name="colDescription" className="input" placeholder={gold ? 'Chain, 2 bangles' : p.assetType === 'VEHICLE' ? 'Honda Activa 6G · 2024' : 'Describe the asset'} required /></div>
              {gold && <>
                <div><label className="label" htmlFor="d_grossWeight">Gross weight (g)</label><input id="d_grossWeight" name="d_grossWeight" type="number" step="0.01" className="input" /></div>
                <div><label className="label" htmlFor="d_netWeight">Net weight (g)</label><input id="d_netWeight" name="d_netWeight" type="number" step="0.01" className="input" value={netWt || ''} onChange={(e) => setNetWt(Number(e.target.value))} required /></div>
                <div><label className="label" htmlFor="d_purityKarat">Purity (karat)</label><select id="d_purityKarat" name="d_purityKarat" className="input" value={karat} onChange={(e) => setKarat(Number(e.target.value))}>{[24, 22, 20, 18, 14].map((k) => <option key={k}>{k}</option>)}</select></div>
                <div><label className="label" htmlFor="goldRate">22K rate today (₹/g)</label><input id="goldRate" type="number" className="input" value={goldRate} onChange={(e) => setGoldRate(Number(e.target.value))} /></div>
                <div><label className="label" htmlFor="d_assay">Assay / stone deduction</label><input id="d_assay" name="d_assay" className="input" placeholder="Touchstone OK, 0.8 g stones" /></div>
                <div><label className="label" htmlFor="colPacket">Packet no.</label><input id="colPacket" name="colPacket" className="input" placeholder="PKT-03-1182" /></div>
              </>}
              {p.assetType === 'VEHICLE' && <>
                <div><label className="label" htmlFor="d_regNo">Registration (RC)</label><input id="d_regNo" name="d_regNo" className="input" placeholder="TN 07 AB 1234" required /></div>
                <div><label className="label" htmlFor="d_chassisNo">Chassis no.</label><input id="d_chassisNo" name="d_chassisNo" className="input" /></div>
                <div><label className="label" htmlFor="d_engineNo">Engine no.</label><input id="d_engineNo" name="d_engineNo" className="input" /></div>
                <div><label className="label" htmlFor="d_insuranceExpiry">Insurance expiry</label><input id="d_insuranceExpiry" name="d_insuranceExpiry" type="date" className="input" /></div>
              </>}
              {p.assetType === 'PROPERTY' && <>
                <div><label className="label" htmlFor="d_surveyNo">Survey / door no.</label><input id="d_surveyNo" name="d_surveyNo" className="input" /></div>
                <div><label className="label" htmlFor="d_areaSqft">Area (sq ft)</label><input id="d_areaSqft" name="d_areaSqft" type="number" className="input" /></div>
                <div><label className="label" htmlFor="d_titleDocs">Title papers on file</label><input id="d_titleDocs" name="d_titleDocs" className="input" placeholder="Sale deed, EC, patta" /></div>
              </>}
              {p.assetType === 'MACHINERY' && <>
                <div><label className="label" htmlFor="d_serialNo">Serial no.</label><input id="d_serialNo" name="d_serialNo" className="input" /></div>
                <div><label className="label" htmlFor="d_invoiceNo">Supplier invoice</label><input id="d_invoiceNo" name="d_invoiceNo" className="input" /></div>
                <div><label className="label" htmlFor="d_supplier">Supplier (disburse to)</label><input id="d_supplier" name="d_supplier" className="input" /></div>
                <div><label className="label" htmlFor="d_warrantyUntil">Warranty until</label><input id="d_warrantyUntil" name="d_warrantyUntil" type="date" className="input" /></div>
              </>}
              {!gold && <div><label className="label" htmlFor="cv">Valuation (₹)</label><input id="cv" type="number" className="input" value={colValue || ''} onChange={(e) => setColValue(Number(e.target.value))} required /></div>}
              <div><label className="label" htmlFor="colValuer">Valued by</label><input id="colValuer" name="colValuer" className="input" placeholder="In-house valuer" /></div>
            </div>
          </section>
        )}

        <section className="card p-5">
          <h2 className="mb-4 text-sm font-semibold">Guarantor (optional)</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><label className="label" htmlFor="gName">Name</label><input id="gName" name="gName" className="input" /></div>
            <div><label className="label" htmlFor="gPhone">Phone</label><input id="gPhone" name="gPhone" className="input" /></div>
            <div><label className="label" htmlFor="gRelation">Relation</label><input id="gRelation" name="gRelation" className="input" /></div>
          </div>
          <div className="mt-3"><label className="label" htmlFor="notes">Notes for the approver</label><textarea id="notes" name="notes" className="input" rows={2} /></div>
        </section>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold">Check before you submit</h2>
          <dl className="space-y-2 text-sm">
            {secured && <>
              <div className="flex justify-between"><dt className="text-mute">Collateral value</dt><dd className="num">{value ? fmtP(value * 100) : '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-mute">LTV</dt><dd className={`num font-semibold ${over ? 'text-bad' : 'text-good'}`}>{ltv != null ? `${ltv}%` : '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-mute">Most you can lend</dt><dd className="num">{cap != null ? fmtP(Math.floor(cap) * 100) : '—'}</dd></div>
            </>}
            <div className="flex justify-between"><dt className="text-mute">{p.method === 'REDUCING' && p.frequency !== 'BULLET' ? 'EMI' : 'First instalment'}</dt><dd className="num">{preview ? fmtP(preview.first.principalDue + preview.first.interestDue) : '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-mute">Total interest</dt><dd className="num">{preview ? fmtP(preview.interest) : '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-mute">Processing + GST</dt><dd className="num">{fmtP(Math.round(fee * (1 + p.gst / 100) * 100))}</dd></div>
            <div className="flex justify-between"><dt className="text-mute">Maturity</dt><dd className="num">{preview ? fmtDate(preview.rows[preview.rows.length - 1].dueDate) : '—'}</dd></div>
          </dl>
          {over && <p className="mt-3 text-sm text-bad">LTV is above the cap for this product.</p>}
          <button className="btn-primary mt-4 w-full" disabled={pending || over}>{pending ? 'Submitting…' : 'Submit for approval'}</button>
          {state?.error && <p role="alert" className="mt-2 text-sm text-bad">{state.error}</p>}
        </section>
        {preview && (
          <section className="card max-h-80 overflow-auto p-0">
            <table className="w-full text-sm"><thead className="sticky top-0 bg-panel"><tr><th className="th">#</th><th className="th">Due</th><th className="th text-right">Amount</th></tr></thead>
              <tbody>{preview.rows.map((r) => <tr key={r.seq} className="tr"><td className="td py-1.5 text-mute">{r.seq}</td><td className="td num py-1.5">{fmtDate(r.dueDate)}</td><td className="td num py-1.5 text-right">{fmtP(r.principalDue + r.interestDue)}</td></tr>)}</tbody>
            </table>
          </section>
        )}
      </aside>
    </form>
  );
}
