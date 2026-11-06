// All arithmetic is done in integer paise to avoid floating-point drift.
// The database stores NUMERIC(14,2) strings; convert at the edges.

export type Paise = number;

export const toPaise = (v: string | number | null | undefined): Paise => {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${v}`);
  return Math.round(n * 100);
};

export const fromPaise = (p: Paise): string => (p / 100).toFixed(2);
export const rupees = (p: Paise): number => p / 100;

/** Round half away from zero to the nearest paisa. */
export const roundP = (x: number): Paise => (x < 0 ? -Math.round(-x) : Math.round(x));

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ₹1,18,600 (Indian grouping). Accepts a numeric string, a number of rupees, or paise via fmtP. */
export function fmt(v: string | number | null | undefined, decimals = false): string {
  const n = typeof v === 'string' ? Number(v) : v ?? 0;
  return `₹${(decimals ? inr2 : inr).format(n)}`;
}
export const fmtP = (p: Paise, decimals = false) => fmt(p / 100, decimals);

/** ₹48.2 Cr / ₹3.9 L — compact Indian units for dashboards. */
export function fmtCompact(rupeesValue: number): string {
  const a = Math.abs(rupeesValue);
  if (a >= 1e7) return `₹${(rupeesValue / 1e7).toFixed(a >= 1e9 ? 0 : 2).replace(/\.?0+$/, '')} Cr`;
  if (a >= 1e5) return `₹${(rupeesValue / 1e5).toFixed(2).replace(/\.?0+$/, '')} L`;
  return fmt(rupeesValue);
}
