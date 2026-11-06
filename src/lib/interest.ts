// Interest engine: schedules, dues, penal interest, payment allocation and repayment scores.
// Pure functions — no database access — so every rule can be unit-tested.
import type { Frequency, InterestMethod } from '@/db/schema';
import { addDays, addMonths, daysBetween, ISODate } from './dates';
import { Paise, roundP } from './money';

export interface Terms {
  principal: Paise;
  annualRate: number; // % per year
  method: InterestMethod;
  frequency: Frequency;
  tenure: number; // number of periods (months for MONTHLY/BULLET, weeks for WEEKLY, days for DAILY)
  startDate: ISODate; // disbursal date
}

export interface ScheduleRow {
  seq: number;
  dueDate: ISODate;
  principalDue: Paise;
  interestDue: Paise;
}

export interface InstallmentState extends ScheduleRow {
  principalPaid: Paise;
  interestPaid: Paise;
}

export const periodsPerYear: Record<Frequency, number> = { MONTHLY: 12, BULLET: 12, WEEKLY: 52, DAILY: 365 };

export function dueDateFor(start: ISODate, frequency: Frequency, i: number): ISODate {
  switch (frequency) {
    case 'WEEKLY': return addDays(start, 7 * i);
    case 'DAILY': return addDays(start, i);
    default: return addMonths(start, i);
  }
}

export function maturityDate(t: Pick<Terms, 'startDate' | 'frequency' | 'tenure'>): ISODate {
  return dueDateFor(t.startDate, t.frequency, t.tenure);
}

/** Equated instalment for a reducing-balance loan. */
export function emi(principal: Paise, annualRate: number, n: number, ppy: number): Paise {
  const i = annualRate / 100 / ppy;
  if (i === 0) return roundP(principal / n);
  return roundP((principal * i) / (1 - Math.pow(1 + i, -n)));
}

/** Build the repayment schedule for a loan. Rounding residue always lands on the last row. */
export function buildSchedule(t: Terms): ScheduleRow[] {
  const { principal: P, annualRate, method, frequency, tenure: n, startDate } = t;
  if (n < 1) throw new Error('Tenure must be at least one period');
  if (P <= 0) throw new Error('Principal must be positive');
  const ppy = periodsPerYear[frequency];
  const rows: ScheduleRow[] = [];
  const bullet = frequency === 'BULLET';

  if (method === 'FLAT') {
    const totalInterest = roundP((P * annualRate * n) / (100 * ppy));
    const perI = Math.floor(totalInterest / n);
    const perP = bullet ? 0 : Math.floor(P / n);
    for (let k = 1; k <= n; k++) {
      const last = k === n;
      rows.push({
        seq: k,
        dueDate: dueDateFor(startDate, frequency, k),
        interestDue: last ? totalInterest - perI * (n - 1) : perI,
        principalDue: bullet ? (last ? P : 0) : last ? P - perP * (n - 1) : perP,
      });
    }
    return rows;
  }

  if (method === 'REDUCING') {
    const i = annualRate / 100 / ppy;
    if (bullet) {
      const perI = roundP(P * i);
      for (let k = 1; k <= n; k++) rows.push({ seq: k, dueDate: dueDateFor(startDate, frequency, k), interestDue: perI, principalDue: k === n ? P : 0 });
      return rows;
    }
    const e = emi(P, annualRate, n, ppy);
    let bal = P;
    for (let k = 1; k <= n; k++) {
      const interest = roundP(bal * i);
      let principal = e - interest;
      if (k === n || principal > bal) principal = bal;
      rows.push({ seq: k, dueDate: dueDateFor(startDate, frequency, k), interestDue: interest, principalDue: principal });
      bal -= principal;
    }
    return rows;
  }

  // DAILY: interest accrues on the actual outstanding for the actual number of days (actual/365).
  // Rows show an estimate assuming every instalment is paid on its due date.
  let bal = P;
  let prev = startDate;
  const perP = bullet ? 0 : Math.floor(P / n);
  for (let k = 1; k <= n; k++) {
    const due = dueDateFor(startDate, frequency, k);
    const days = daysBetween(prev, due);
    const interest = roundP((bal * annualRate * days) / (100 * 365));
    const principal = bullet ? (k === n ? P : 0) : k === n ? bal : perP;
    rows.push({ seq: k, dueDate: due, interestDue: interest, principalDue: principal });
    bal -= principal;
    prev = due;
  }
  return rows;
}

/** Simple interest for `days` on `amount` at `annualRate` % (actual/365). */
export const simpleInterest = (amount: Paise, annualRate: number, days: number): Paise =>
  days <= 0 || amount <= 0 ? 0 : roundP((amount * annualRate * days) / (100 * 365));

export interface LoanState {
  method: InterestMethod;
  frequency: Frequency;
  annualRate: number;
  penalRate: number; // extra % per year on overdue amounts
  graceDays: number;
  outstanding: Paise; // principal outstanding
  interestPaidTo: ISODate | null; // DAILY only
  startDate: ISODate;
}

export interface Dues {
  asOf: ISODate;
  penalty: Paise;
  interest: Paise; // interest payable now (overdue instalment interest, or accrued for DAILY)
  principalOverdue: Paise;
  dueNow: Paise; // what clears all arrears today
  payoff: Paise; // what closes the loan today
  dpd: number;
  nextDue: { date: ISODate; amount: Paise } | null;
}

const unpaidI = (r: InstallmentState) => Math.max(0, r.interestDue - r.interestPaid);
const unpaidP = (r: InstallmentState) => Math.max(0, r.principalDue - r.principalPaid);
const isPaid = (r: InstallmentState) => unpaidI(r) === 0 && unpaidP(r) === 0;

export function computeDpd(rows: InstallmentState[], asOf: ISODate, method: InterestMethod): number {
  const oldest = rows.find((r) => r.dueDate < asOf && (method === 'DAILY' ? unpaidP(r) > 0 : !isPaid(r)));
  return oldest ? daysBetween(oldest.dueDate, asOf) : 0;
}

/** Accrued interest for DAILY loans, from the paid-to date up to asOf. */
export function accruedDaily(s: LoanState, asOf: ISODate): Paise {
  const from = s.interestPaidTo ?? s.startDate;
  return simpleInterest(s.outstanding, s.annualRate, daysBetween(from, asOf));
}

/** Penal interest on overdue instalment amounts beyond the grace period. */
export function penalty(s: LoanState, rows: InstallmentState[], asOf: ISODate): Paise {
  let total = 0;
  for (const r of rows) {
    if (r.dueDate >= asOf) continue;
    const late = daysBetween(r.dueDate, asOf);
    if (late <= s.graceDays) continue;
    const overdue = unpaidP(r) + (s.method === 'DAILY' ? 0 : unpaidI(r));
    total += simpleInterest(overdue, s.penalRate, late);
  }
  return total;
}

export function computeDues(s: LoanState, rows: InstallmentState[], asOf: ISODate): Dues {
  const pen = penalty(s, rows, asOf);
  const past = rows.filter((r) => r.dueDate <= asOf);
  const principalOverdue = past.reduce((a, r) => a + unpaidP(r), 0);
  const interest = s.method === 'DAILY' ? accruedDaily(s, asOf) : past.reduce((a, r) => a + unpaidI(r), 0);
  const upcoming = rows.find((r) => r.dueDate > asOf && !isPaid(r));
  return {
    asOf,
    penalty: pen,
    interest,
    principalOverdue,
    dueNow: pen + interest + principalOverdue,
    payoff: pen + interest + s.outstanding,
    dpd: computeDpd(rows, asOf, s.method),
    nextDue: upcoming ? { date: upcoming.dueDate, amount: unpaidP(upcoming) + unpaidI(upcoming) } : null,
  };
}

export interface Allocation {
  toPenalty: Paise;
  toInterest: Paise;
  toPrincipal: Paise;
  unapplied: Paise; // over-payment beyond payoff (returned or held)
  rows: InstallmentState[]; // updated instalments (may include a regenerated tail)
  outstanding: Paise;
  interestPaidTo: ISODate | null;
  closed: boolean;
}

/**
 * Apply a payment. Order: penal interest → interest → principal (overdue first, then prepayment).
 * Prepayment on a REDUCING or DAILY loan lowers the outstanding principal, so later interest falls —
 * "pay small, owe less". On a FLAT loan, extra money is paid towards the next instalments in order.
 */
export function allocatePayment(s: LoanState, input: InstallmentState[], amount: Paise, asOf: ISODate): Allocation {
  if (amount <= 0) throw new Error('Payment must be positive');
  const rows = input.map((r) => ({ ...r }));
  let left = amount;
  let outstanding = s.outstanding;
  let interestPaidTo = s.interestPaidTo;

  // 1. penal interest
  const pen = penalty(s, rows, asOf);
  const toPenalty = Math.min(left, pen);
  left -= toPenalty;

  let toInterest = 0;
  let toPrincipal = 0;

  if (s.method === 'DAILY') {
    // 2. accrued interest up to today
    const accrued = accruedDaily(s, asOf);
    const from = interestPaidTo ?? s.startDate;
    if (accrued > 0) {
      if (left >= accrued) {
        toInterest = accrued;
        left -= accrued;
        interestPaidTo = asOf;
      } else {
        // part-payment of interest: move the paid-to date forward by the whole days it covers
        const perDay = simpleInterest(outstanding, s.annualRate, 1) || 1;
        const days = Math.floor(left / perDay);
        toInterest = days * perDay;
        left -= toInterest;
        interestPaidTo = addDays(from, days);
      }
    } else if (!interestPaidTo) interestPaidTo = asOf;
    // mark interest against instalment rows for display, oldest first
    let iLeft = toInterest;
    for (const r of rows) {
      if (iLeft <= 0) break;
      const take = Math.min(iLeft, unpaidI(r));
      r.interestPaid += take;
      iLeft -= take;
    }
    // 3. principal: overdue first, then any remaining as prepayment in order
    for (const r of rows) {
      if (left <= 0) break;
      const take = Math.min(left, unpaidP(r));
      r.principalPaid += take;
      left -= take;
      toPrincipal += take;
    }
    outstanding -= toPrincipal;
  } else {
    // 2–3. overdue instalments, oldest first: interest then principal
    for (const r of rows) {
      if (left <= 0 || r.dueDate > asOf) continue;
      const i = Math.min(left, unpaidI(r)); r.interestPaid += i; left -= i; toInterest += i;
      const p = Math.min(left, unpaidP(r)); r.principalPaid += p; left -= p; toPrincipal += p;
    }
    if (left > 0 && s.method === 'FLAT') {
      // advance payment towards upcoming instalments
      for (const r of rows) {
        if (left <= 0 || r.dueDate <= asOf) continue;
        const i = Math.min(left, unpaidI(r)); r.interestPaid += i; left -= i; toInterest += i;
        const p = Math.min(left, unpaidP(r)); r.principalPaid += p; left -= p; toPrincipal += p;
      }
    }
    outstanding -= toPrincipal;
    if (left > 0 && s.method === 'REDUCING' && outstanding > 0) {
      // prepayment: reduce principal, then re-spread what's left over the remaining instalments
      const pre = Math.min(left, outstanding);
      left -= pre;
      toPrincipal += pre;
      outstanding -= pre;
      const future = rows.filter((r) => r.dueDate > asOf && !isPaid(r));
      const kept = rows.filter((r) => !(r.dueDate > asOf && !isPaid(r)));
      // record the prepaid principal on the next instalment so the schedule still adds up to the loan
      if (future.length) future[0].principalPaid += pre;
      if (future.length && outstanding > 0) {
        const ppy = periodsPerYear[s.frequency];
        const i = s.annualRate / 100 / ppy;
        const n = future.length;
        const e = s.frequency === 'BULLET' ? 0 : emi(outstanding, s.annualRate, n, ppy);
        let bal = outstanding;
        future.forEach((r, k) => {
          const interest = roundP(bal * i);
          let principal = s.frequency === 'BULLET' ? (k === n - 1 ? bal : 0) : e - interest;
          if (k === n - 1 || principal > bal) principal = bal;
          Object.assign(r, { interestDue: interest + r.interestPaid, principalDue: principal + r.principalPaid });
          bal -= principal;
        });
        rows.splice(0, rows.length, ...kept, ...future);
      } else if (outstanding === 0) {
        // fully prepaid: close the remaining rows at what has been paid
        for (const r of future) { r.principalDue = r.principalPaid; r.interestDue = r.interestPaid; }
      }
    }
  }

  // Loan fully repaid: future interest on a reducing loan is not charged
  if (outstanding <= 0 && s.method !== 'FLAT') {
    for (const r of rows) if (r.dueDate > asOf) { r.interestDue = r.interestPaid; r.principalDue = r.principalPaid; }
  }
  const closed = outstanding <= 0 && rows.every(isPaid);
  return { toPenalty, toInterest, toPrincipal, unapplied: left, rows, outstanding: Math.max(0, outstanding), interestPaidTo, closed };
}

/**
 * Repayment score on a 300–900 scale, built only from repayment behaviour on FinX.
 * Internal use; not a credit bureau score.
 */
export function repaymentScore(h: { onTime: number; late: number; currentDpd: number; closedLoans: number }): number {
  const s = 650 + Math.min(200, h.onTime * 8) + Math.min(50, h.closedLoans * 15) - h.late * 12 - Math.min(250, h.currentDpd * 3);
  return Math.max(300, Math.min(900, Math.round(s)));
}

/** Largest loan allowed against a collateral value, honouring tiered LTV caps. */
export function maxLoanFor(value: Paise, maxLtv: number | null, tiers?: { upTo: number; maxLtv: number }[] | null): Paise {
  if (maxLtv === null) return Number.MAX_SAFE_INTEGER;
  if (tiers?.length) {
    // tiers are in rupees of loan amount; pick the highest amount that satisfies its tier cap
    const sorted = [...tiers].sort((a, b) => a.upTo - b.upTo);
    let best = 0;
    for (const t of sorted) best = Math.max(best, Math.min(t.upTo * 100, roundP((value * t.maxLtv) / 100)));
    return best;
  }
  return roundP((value * maxLtv) / 100);
}

export const ltvPct = (loan: Paise, value: Paise) => (value > 0 ? Math.round((loan / value) * 10000) / 100 : 0);
