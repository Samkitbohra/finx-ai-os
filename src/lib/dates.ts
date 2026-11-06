// Business dates are calendar days in India (IST). We pass them around as 'YYYY-MM-DD' strings
// and do day arithmetic in UTC so daylight-saving and server time zones never shift a day.

export type ISODate = string; // YYYY-MM-DD

const DAY = 86_400_000;

export function todayIST(now = new Date()): ISODate {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return ist.toISOString().slice(0, 10);
}

/** Current hour (0–23) in India. */
export function hourIST(now = new Date()): number {
  return new Date(now.getTime() + 330 * 60_000).getUTCHours();
}

export const parse = (d: ISODate): number => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const iso = (ms: number): ISODate => new Date(ms).toISOString().slice(0, 10);

export const addDays = (d: ISODate, n: number): ISODate => iso(parse(d) + n * DAY);

/** Days from a to b (b - a). */
export const daysBetween = (a: ISODate, b: ISODate): number => Math.round((parse(b) - parse(a)) / DAY);

/** Add months, clamping to month end (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(d: ISODate, n: number): ISODate {
  const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1, day = +d.slice(8, 10);
  const target = new Date(Date.UTC(y, m + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return iso(target.getTime());
}

export const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function fmtDate(d: ISODate | Date | null | undefined, style: 'short' | 'long' = 'short'): string {
  if (!d) return '—';
  const ms = typeof d === 'string' ? parse(d) : d.getTime();
  return new Date(ms).toLocaleDateString('en-IN', {
    day: '2-digit', month: style === 'long' ? 'long' : 'short', year: 'numeric', timeZone: 'UTC',
  });
}

export const monthKey = (d: ISODate) => d.slice(0, 7);
