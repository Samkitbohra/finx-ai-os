import { describe, it, expect } from 'vitest';
import { buildSchedule, emi, computeDues, allocatePayment, InstallmentState, LoanState, maxLoanFor, repaymentScore } from '@/lib/interest';
import { addMonths, daysBetween } from '@/lib/dates';

const rows = (t: Parameters<typeof buildSchedule>[0]): InstallmentState[] =>
  buildSchedule(t).map((r) => ({ ...r, principalPaid: 0, interestPaid: 0 }));
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe('dates', () => {
  it('clamps month ends', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(daysBetween('2026-01-01', '2026-12-31')).toBe(364);
  });
});

describe('schedules', () => {
  it('reducing EMI matches the standard formula and repays exactly', () => {
    // ₹1,00,000 at 12% for 12 months → EMI ₹8,884.88
    expect(emi(10_000_000, 12, 12, 12)).toBe(888_488);
    const s = buildSchedule({ principal: 10_000_000, annualRate: 12, method: 'REDUCING', frequency: 'MONTHLY', tenure: 12, startDate: '2026-01-15' });
    expect(s).toHaveLength(12);
    expect(sum(s.map((r) => r.principalDue))).toBe(10_000_000);
    expect(s[0].interestDue).toBe(100_000); // 1% of 1,00,000
    expect(s[0].dueDate).toBe('2026-02-15');
  });

  it('flat interest is fixed on the original principal', () => {
    const s = buildSchedule({ principal: 5_000_000, annualRate: 24, method: 'FLAT', frequency: 'MONTHLY', tenure: 10, startDate: '2026-01-01' });
    expect(sum(s.map((r) => r.interestDue))).toBe(1_000_000); // 50,000 × 24% × 10/12
    expect(sum(s.map((r) => r.principalDue))).toBe(5_000_000);
  });

  it('gold bullet on daily interest: interest monthly, principal at maturity', () => {
    const s = buildSchedule({ principal: 4_500_000, annualRate: 22, method: 'DAILY', frequency: 'BULLET', tenure: 6, startDate: '2026-01-01' });
    expect(s.slice(0, 5).every((r) => r.principalDue === 0)).toBe(true);
    expect(s[5].principalDue).toBe(4_500_000);
    expect(s[0].interestDue).toBe(Math.round((4_500_000 * 22 * 31) / 36500)); // January has 31 days
  });
});

describe('dues and payments', () => {
  const state = (o: Partial<LoanState> = {}): LoanState => ({
    method: 'REDUCING', frequency: 'MONTHLY', annualRate: 12, penalRate: 2, graceDays: 3,
    outstanding: 10_000_000, interestPaidTo: null, startDate: '2026-01-15', ...o,
  });

  it('nothing is due before the first instalment', () => {
    const r = rows({ principal: 10_000_000, annualRate: 12, method: 'REDUCING', frequency: 'MONTHLY', tenure: 12, startDate: '2026-01-15' });
    const d = computeDues(state(), r, '2026-02-01');
    expect(d.dueNow).toBe(0);
    expect(d.dpd).toBe(0);
    expect(d.nextDue?.date).toBe('2026-02-15');
  });

  it('a late instalment carries DPD and penal interest after grace', () => {
    const r = rows({ principal: 10_000_000, annualRate: 12, method: 'REDUCING', frequency: 'MONTHLY', tenure: 12, startDate: '2026-01-15' });
    const d = computeDues(state(), r, '2026-03-01'); // 14 days after 15 Feb
    expect(d.dpd).toBe(14);
    expect(d.penalty).toBeGreaterThan(0);
    expect(d.dueNow).toBe(d.penalty + 888_488);
  });

  it('allocates penalty → interest → principal and closes on payoff', () => {
    const r = rows({ principal: 10_000_000, annualRate: 12, method: 'REDUCING', frequency: 'MONTHLY', tenure: 12, startDate: '2026-01-15' });
    const a = allocatePayment(state(), r, 888_488, '2026-02-15');
    expect(a.toPenalty).toBe(0);
    expect(a.toInterest).toBe(100_000);
    expect(a.toPrincipal).toBe(788_488);
    expect(a.outstanding).toBe(10_000_000 - 788_488);
    const d = computeDues({ ...state(), outstanding: a.outstanding }, a.rows, '2026-02-15');
    const b = allocatePayment({ ...state(), outstanding: a.outstanding }, a.rows, d.payoff, '2026-02-15');
    expect(b.closed).toBe(true);
    expect(b.outstanding).toBe(0);
  });

  it('prepayment on a reducing loan lowers future interest', () => {
    const r = rows({ principal: 10_000_000, annualRate: 12, method: 'REDUCING', frequency: 'MONTHLY', tenure: 12, startDate: '2026-01-15' });
    const before = sum(r.map((x) => x.interestDue));
    const a = allocatePayment(state(), r, 2_000_000, '2026-01-20'); // ₹20,000 extra, nothing due yet
    expect(a.toPrincipal).toBe(2_000_000);
    expect(sum(a.rows.map((x) => x.interestDue))).toBeLessThan(before);
    expect(sum(a.rows.map((x) => x.principalDue))).toBe(10_000_000);
  });

  it('daily-interest gold loan: part-payment of interest moves the paid-to date', () => {
    const s = state({ method: 'DAILY', frequency: 'BULLET', annualRate: 22, outstanding: 4_500_000, startDate: '2026-01-01' });
    const r = rows({ principal: 4_500_000, annualRate: 22, method: 'DAILY', frequency: 'BULLET', tenure: 6, startDate: '2026-01-01' });
    const perDay = Math.round((4_500_000 * 22) / 36500);
    const a = allocatePayment(s, r, perDay * 10, '2026-01-31');
    expect(a.toInterest).toBe(perDay * 10);
    expect(a.interestPaidTo).toBe('2026-01-11');
    expect(a.toPrincipal).toBe(0);
  });

  it('daily-interest: paying ₹100 of principal early reduces interest owed', () => {
    const s = state({ method: 'DAILY', frequency: 'BULLET', annualRate: 21, outstanding: 4_000_000, startDate: '2026-01-01', interestPaidTo: '2026-01-01' });
    const r = rows({ principal: 4_000_000, annualRate: 21, method: 'DAILY', frequency: 'BULLET', tenure: 6, startDate: '2026-01-01' });
    const a = allocatePayment(s, r, 10_000, '2026-01-01');
    expect(a.toPrincipal).toBe(10_000);
    const later = computeDues({ ...s, outstanding: a.outstanding, interestPaidTo: a.interestPaidTo }, a.rows, '2026-07-01');
    const without = computeDues(s, r, '2026-07-01');
    expect(later.interest).toBeLessThan(without.interest);
  });
});

describe('collateral and score', () => {
  it('applies tiered LTV caps', () => {
    // ₹1,00,000 of gold; ≤ ₹2.5L loans capped at 85%, above at 75%
    expect(maxLoanFor(10_000_000, 75, [{ upTo: 250000, maxLtv: 85 }, { upTo: 99999999, maxLtv: 75 }])).toBe(8_500_000);
    expect(maxLoanFor(10_000_000, 75)).toBe(7_500_000);
  });
  it('keeps scores inside 300–900', () => {
    expect(repaymentScore({ onTime: 100, late: 0, currentDpd: 0, closedLoans: 5 })).toBe(900);
    expect(repaymentScore({ onTime: 0, late: 30, currentDpd: 120, closedLoans: 0 })).toBe(300);
  });
});
