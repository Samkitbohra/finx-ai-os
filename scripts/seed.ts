// Demo data: one lender, three branches, staff in every role, six products and ~6 months of history.
// Everything goes through the real services, so the ledger, schedules and scores are consistent.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db';
import type { Ctx } from '../src/lib/auth';
import { ensureChart, post } from '../src/server/core';
import { approveLoan, createBorrower, createLoan, disburseLoan, recordPayment, verifyKyc, refreshPortfolio } from '../src/server/loans';
import { addDays, addMonths, daysBetween, todayIST } from '../src/lib/dates';
import { seedTemplates } from '../src/server/agent';

const T = schema;
let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <X,>(a: X[]) => a[Math.floor(rnd() * a.length)];
const between = (a: number, b: number) => Math.round(a + rnd() * (b - a));

const FIRST = ['Ramesh', 'Kannan', 'Fathima', 'Suresh', 'Lakshmi', 'Mohammed', 'Anitha', 'Murugan', 'Priya', 'Arjun', 'Selvi', 'Karthik', 'Divya', 'Rajesh', 'Meena', 'Imran', 'Saravanan', 'Kavitha', 'Vijay', 'Deepa', 'Abdul', 'Gowri', 'Prakash', 'Revathi', 'Joseph', 'Mary', 'Senthil', 'Banu', 'Ganesh', 'Shalini'];
const LAST = ['Kumar', 'Begum', 'Raman', 'Iqbal', 'Mehta', 'Fernandes', 'Pillai', 'Nair', 'Reddy', 'Sundaram', 'Krishnan', 'Shaikh', 'Devi', 'Babu', 'Rao'];
const AREAS = [['Mylapore', '600004'], ['T. Nagar', '600017'], ['Adyar', '600020'], ['Tambaram', '600045'], ['Velachery', '600042'], ['Porur', '600116'], ['Anna Nagar', '600040'], ['Perambur', '600011']];
const LANGS = ['ta', 'ta', 'ta', 'en', 'hi', 'te', 'ml', 'kn'];
const JOBS = ['Vegetable vendor', 'Tailor', 'Auto driver', 'Kirana shop owner', 'Farmer', 'Electrician', 'Small trader', 'Salon owner', 'Mechanic', 'Teacher'];

async function main() {
  const today = todayIST();
  const existing = await db.query.organizations.findFirst();
  if (existing) { console.log('Already seeded. Run `npm run db:reset` to start fresh.'); process.exit(0); }

  const [org] = await db.insert(T.organizations).values({
    name: 'Sri Lakshmi Finance', legalName: 'Sri Lakshmi Finance & Investments', licenseNo: 'TN/PB/CHN/2019/0412', state: 'Tamil Nadu',
    gstin: '33AAKFS1234L1Z5', pan: 'AAKFS1234L', address: '14 Royapettah High Road, Mylapore, Chennai 600004', phone: '+91 44 2499 1200',
    email: 'accounts@srilakshmifinance.in', upiVpa: 'srilakshmifin@hdfcbank', defaultLanguage: 'ta',
  }).returning();
  await ensureChart(db, org.id);

  const branches = await db.insert(T.branches).values([
    { orgId: org.id, code: '01', name: 'Mylapore', city: 'Chennai', state: 'Tamil Nadu', address: '14 Royapettah High Road, Mylapore' },
    { orgId: org.id, code: '02', name: 'Tambaram', city: 'Chennai', state: 'Tamil Nadu', address: '22 GST Road, Tambaram' },
    { orgId: org.id, code: '03', name: 'Velachery', city: 'Chennai', state: 'Tamil Nadu', address: '5 100 Feet Road, Velachery' },
  ]).returning();

  const hash = await bcrypt.hash('finx1234', 10);
  const people: [string, string, (typeof T.roleEnum.enumValues)[number], number | null][] = [
    ['Samkit Bohra', 'owner@finx.demo', 'OWNER', null],
    ['Anjali Rao', 'admin@finx.demo', 'ADMIN', null],
    ['S. Bohra', 'manager@finx.demo', 'BRANCH_MANAGER', 2],
    ['Karthik Raman', 'officer@finx.demo', 'LOAN_OFFICER', 2],
    ['Meena Krishnan', 'accounts@finx.demo', 'ACCOUNTANT', null],
    ['Vijay Kumar', 'collections@finx.demo', 'COLLECTOR', 2],
    ['R. Sundaram (CA)', 'auditor@finx.demo', 'AUDITOR', null],
    ['Priya Nair', 'mylapore@finx.demo', 'BRANCH_MANAGER', 0],
    ['Imran Shaikh', 'tambaram@finx.demo', 'BRANCH_MANAGER', 1],
  ];
  const users = await db.insert(T.users).values(people.map(([name, email, role, b]) => ({ orgId: org.id, name, email, role, passwordHash: hash, branchId: b == null ? null : branches[b].id, phone: `+9198${between(10000000, 99999999)}` }))).returning();
  const owner = users[0];
  const ctx: Ctx = { orgId: org.id, userId: owner.id, role: 'OWNER', branchId: null, name: owner.name, via: 'SYSTEM' };

  const products = await db.insert(T.products).values([
    { orgId: org.id, name: 'Jewel loan', assetType: 'GOLD', interestMethod: 'DAILY', frequency: 'BULLET', annualRate: '21', penalRate: '2', minAmount: '2000', maxAmount: '2500000', minTenure: 1, maxTenure: 12, maxLtv: '75', ltvTiers: [{ upTo: 250000, maxLtv: 85 }, { upTo: 500000, maxLtv: 80 }, { upTo: 99999999, maxLtv: 75 }], processingFeePct: '0.5', graceDays: 7 },
    { orgId: org.id, name: 'Two-wheeler loan', assetType: 'VEHICLE', interestMethod: 'REDUCING', frequency: 'MONTHLY', annualRate: '19', minAmount: '20000', maxAmount: '300000', minTenure: 6, maxTenure: 36, maxLtv: '85', processingFeePct: '2' },
    { orgId: org.id, name: 'Loan against property', assetType: 'PROPERTY', interestMethod: 'REDUCING', frequency: 'MONTHLY', annualRate: '14.5', minAmount: '200000', maxAmount: '10000000', minTenure: 12, maxTenure: 120, maxLtv: '60', processingFeePct: '1' },
    { orgId: org.id, name: 'Machinery loan', assetType: 'MACHINERY', interestMethod: 'REDUCING', frequency: 'MONTHLY', annualRate: '16', minAmount: '50000', maxAmount: '2500000', minTenure: 6, maxTenure: 48, maxLtv: '80', processingFeePct: '1.5' },
    { orgId: org.id, name: 'Daily business loan', assetType: 'BUSINESS', interestMethod: 'FLAT', frequency: 'WEEKLY', annualRate: '24', minAmount: '10000', maxAmount: '200000', minTenure: 10, maxTenure: 52, maxLtv: null, processingFeePct: '2' },
    { orgId: org.id, name: 'Personal loan', assetType: 'UNSECURED', interestMethod: 'FLAT', frequency: 'MONTHLY', annualRate: '26', minAmount: '5000', maxAmount: '100000', minTenure: 3, maxTenure: 18, maxLtv: null, processingFeePct: '2.5' },
  ]).returning();
  const [gold, bike, lap, mach, biz, pers] = products;

  // opening capital and borrowings, six months back
  const opening = addMonths(today, -7);
  await post(db, ctx, { date: opening, narration: "Owner's capital introduced", sourceType: 'MANUAL', lines: [{ account: 'BANK', debit: 1_50_00_000_00 }, { account: 'CAPITAL', credit: 1_50_00_000_00 }] });
  await post(db, ctx, { date: opening, narration: 'Term loan from bank', sourceType: 'MANUAL', lines: [{ account: 'BANK', debit: 50_00_000_00 }, { account: 'BORROWINGS', credit: 50_00_000_00 }] });
  await post(db, ctx, { date: opening, narration: 'Cash withdrawn for branch counters', sourceType: 'MANUAL', lines: [{ account: 'CASH', debit: 25_00_000_00 }, { account: 'BANK', credit: 25_00_000_00 }] });
  for (let m = 6; m >= 1; m--) {
    const d = addDays(addMonths(today, -m), 0).slice(0, 8) + '28';
    if (d > today) continue;
    await post(db, ctx, { date: d, narration: 'Staff salaries', sourceType: 'EXPENSE', lines: [{ account: 'SALARIES', debit: 1_10_000_00 }, { account: 'BANK', credit: 1_10_000_00 }] });
    await post(db, ctx, { date: d, narration: 'Branch rent (3 branches)', sourceType: 'EXPENSE', lines: [{ account: 'RENT', debit: 36_000_00 }, { account: 'BANK', credit: 36_000_00 }] });
    await post(db, ctx, { date: d, narration: 'Interest on term loan', sourceType: 'EXPENSE', lines: [{ account: 'INTEREST_EXPENSE', debit: 45_800_00 }, { account: 'BANK', credit: 45_800_00 }] });
  }

  await seedTemplates(org.id);

  const plans: { p: typeof gold; weight: number; amt: () => number; tenure: () => number; col?: () => { assetType: typeof gold.assetType; description: string; details: Record<string, unknown>; ratio: number } }[] = [
    { p: gold, weight: 45, amt: () => between(25, 450) * 1000, tenure: () => pick([3, 6, 6, 12]), col: () => { const g = between(8, 80) + rnd(); return { assetType: 'GOLD', description: `${pick(['Chain', 'Bangles (2)', 'Necklace', 'Ring and chain', 'Haram', 'Earrings and chain'])}`, details: { grossWeight: +(g + 1.2).toFixed(1), netWeight: +g.toFixed(1), purityKarat: pick([22, 22, 22, 20, 18]) }, ratio: pick([0.62, 0.68, 0.71, 0.74, 0.78]) }; } },
    { p: bike, weight: 18, amt: () => between(45, 140) * 1000, tenure: () => pick([12, 18, 24]), col: () => ({ assetType: 'VEHICLE', description: `${pick(['TVS Jupiter', 'Honda Activa 6G', 'Bajaj Pulsar 150', 'Hero Splendor+', 'Suzuki Access'])} · ${pick([2023, 2024, 2025])}`, details: { regNo: `TN 0${between(1, 9)} ${pick(['AB', 'BK', 'CZ', 'DM'])} ${between(1000, 9999)}`, chassisNo: `ME4JF${between(100000, 999999)}`, engineNo: `JF${between(1000000, 9999999)}`, insuranceExpiry: addDays(today, between(-10, 300)) }, ratio: pick([0.74, 0.8, 0.84]) }) },
    { p: lap, weight: 6, amt: () => between(4, 30) * 100000, tenure: () => pick([36, 60, 84]), col: () => ({ assetType: 'PROPERTY', description: `${pick(['Shop', 'House', 'Flat', 'Plot'])} · ${pick(AREAS)[0]}`, details: { surveyNo: `${between(10, 400)}/${between(1, 9)}`, areaSqft: between(400, 2400), titleDocs: ['Sale deed', 'EC 13 years', 'Patta'], encumbranceCleared: true }, ratio: pick([0.42, 0.52, 0.58]) }) },
    { p: mach, weight: 6, amt: () => between(1, 12) * 100000, tenure: () => pick([12, 24, 36]), col: () => ({ assetType: 'MACHINERY', description: pick(['CNC lathe', 'Power loom', 'Flour mill', 'Commercial oven', 'Embroidery machine']), details: { serialNo: `SN${between(100000, 999999)}`, invoiceNo: `INV/${between(1000, 9999)}`, supplier: pick(['Lakshmi Machine Works', 'Kumar Industries', 'Ace Tools']), warrantyUntil: addMonths(today, between(6, 24)) }, ratio: pick([0.7, 0.75, 0.78]) }) },
    { p: biz, weight: 15, amt: () => between(20, 150) * 1000, tenure: () => pick([20, 26, 40]) },
    { p: pers, weight: 10, amt: () => between(10, 80) * 1000, tenure: () => pick([6, 9, 12]) },
  ];
  const totalW = plans.reduce((a, p) => a + p.weight, 0);
  const choosePlan = () => { let r = rnd() * totalW; for (const p of plans) { if ((r -= p.weight) <= 0) return p; } return plans[0]; };

  const N = 140;
  let made = 0;
  for (let i = 0; i < N; i++) {
    const area = pick(AREAS);
    const branch = branches[i % 3];
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const b = await createBorrower(ctx, {
      branchId: branch.id, name, phone: `+91${pick(['9', '8', '7', '6'])}${between(100000000, 999999999)}`, language: pick(LANGS),
      address: `${between(1, 140)}, ${pick(['Kamarajar St', 'Gandhi Rd', 'Bharathi St', 'Main Rd', 'Temple St'])}, ${area[0]}`, city: 'Chennai', state: 'Tamil Nadu', pincode: area[1],
      occupation: pick(JOBS), monthlyIncome: between(12, 60) * 1000, pan: rnd() < 0.7 ? `${'ABCDEFGHJK'[between(0, 9)]}${'ABCDEFGHJK'[between(0, 9)]}${'PQRSTUVWX'[between(0, 8)]}P${'KLMNO'[between(0, 4)]}${between(1000, 9999)}${'ABCDE'[between(0, 4)]}` : '',
      aadhaarLast4: String(between(1000, 9999)), consentChannels: rnd() < 0.85 ? ['VOICE', 'WHATSAPP', 'SMS'] : ['SMS'],
      email: rnd() < 0.35 ? `${name.split(' ')[0].toLowerCase()}${between(10, 99)}@gmail.com` : '',
    });
    if (i < N - 4) await verifyKyc(ctx, b.id, true);
    const behaviour = rnd(); // < .7 good, < .88 sometimes late, else struggling
    const loansFor = rnd() < 0.15 ? 2 : 1;
    for (let k = 0; k < loansFor; k++) {
      const plan = choosePlan();
      let amount = plan.amt();
      const tenure = plan.tenure();
      const c = plan.col?.();
      const collaterals = c ? [{ assetType: c.assetType, description: c.description, details: c.details, value: Math.round(amount / c.ratio / 100) * 100, valuer: 'In-house valuer', packetNo: c.assetType === 'GOLD' ? `PKT-${branch.code}-${between(1000, 9999)}` : undefined }] : [];
      if (c?.assetType === 'GOLD') {
        // value gold at ₹6,950/g of 22K equivalent
        const det = c.details as { netWeight: number; purityKarat: number };
        const val = Math.round((det.netWeight * 6950 * det.purityKarat) / 22);
        collaterals[0].value = val;
        amount = Math.min(amount, Math.floor((val * c.ratio) / 100) * 100);
      }
      let loan;
      try {
        loan = await createLoan(ctx, { borrowerId: b.id, productId: plan.p.id, principal: amount, tenure, collaterals, purpose: pick(['Business', 'Medical', 'Education', 'Agriculture', 'Family function', 'Working capital']) });
      } catch (e) { console.warn('skip loan:', (e as Error).message); continue; }
      if (i >= N - 4) continue; // left pending for the approvals queue
      await approveLoan(ctx, loan.id, true);
      if (i >= N - 7) continue; // approved, awaiting disbursal
      const periodDays = plan.p.frequency === 'WEEKLY' ? 7 : 30;
      const maxBack = Math.min(185, periodDays * tenure + 20);
      const start = addDays(today, -between(plan.p.frequency === 'WEEKLY' ? 20 : 12, maxBack));
      await disburseLoan(ctx, loan.id, { mode: pick(['CASH', 'NEFT', 'UPI']), date: start });
      made++;
      // repayment history
      const inst = await db.select().from(T.installments).where(eq(T.installments.loanId, loan.id));
      inst.sort((x, y) => x.seq - y.seq);
      const paymentDays: { date: string; amount: number }[] = [];
      for (const r of inst) {
        if (r.dueDate > today) break;
        const due = Number(r.principalDue) + Number(r.interestDue);
        if (behaviour < 0.7) paymentDays.push({ date: addDays(r.dueDate, between(-2, 2)), amount: due });
        else if (behaviour < 0.88) { if (rnd() < 0.8) paymentDays.push({ date: addDays(r.dueDate, between(3, 25)), amount: due * 1.01 }); }
        else if (rnd() < 0.35) paymentDays.push({ date: addDays(r.dueDate, between(10, 45)), amount: due * 0.6 });
      }
      if (plan.p.interestMethod === 'DAILY' && behaviour < 0.7 && rnd() < 0.5) paymentDays.push({ date: addDays(start, between(5, Math.max(6, daysBetween(start, today) - 1))), amount: between(1, 20) * 500 });
      paymentDays.sort((x, y) => (x.date < y.date ? -1 : 1));
      for (const pd of paymentDays) {
        if (pd.date > today || pd.date < start) continue;
        try { await recordPayment({ ...ctx, userId: users[pick([3, 5, 7, 8])].id }, loan.id, { amount: Math.round(pd.amount), mode: pick(['CASH', 'UPI', 'UPI', 'NEFT']), date: pd.date }); }
        catch (e) { if (!String((e as Error).message).includes('active')) console.warn('pay:', (e as Error).message); }
      }
      // a few borrowers close their gold loan early
      if (plan.p.assetType === 'GOLD' && behaviour < 0.5 && rnd() < 0.3) {
        const { getDues } = await import('../src/server/loans');
        const d = await getDues(ctx, loan.id);
        if (d && d.payoff > 0) await recordPayment(ctx, loan.id, { amount: d.payoff / 100, mode: 'CASH' }).catch(() => {});
      }
    }
  }
  await refreshPortfolio(org.id);
  const [bt] = [await db.insert(T.branchTargets).values(branches.map((b) => ({ branchId: b.id, month: today.slice(0, 7), disbursalTarget: '6000000', collectionTarget: '2500000', incentivePct: '0.5' }))).returning()];
  console.log(`Seeded ${org.name}: ${branches.length} branches, ${users.length} staff, ${products.length} products, ${made} disbursed loans, ${bt.length} targets.`);
  console.log('Sign in at /login with owner@finx.demo / finx1234 (other roles: admin, manager, officer, accounts, collections, auditor @finx.demo).');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
