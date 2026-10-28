import { financeDateKey, type FinanceDateRange } from './financeDateFilters';
export type ProfitabilityPeriod = 'today' | 'week' | 'month' | 'monthly' | 'biannual' | 'annual';

/** Calendar date presets over the existing reporting dataset; no accounting changes. */
export function profitabilityPeriodRange(period: ProfitabilityPeriod, anchor = financeDateKey(new Date())): FinanceDateRange {
  const date = new Date(`${anchor}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error('Choose a valid reporting date.');
  const year = date.getUTCFullYear(), month = date.getUTCMonth();
  const key = (d: Date) => d.toISOString().slice(0, 10);
  if (period === 'today') return { start: anchor, end: anchor };
  if (period === 'week') {
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const end = new Date(date); end.setUTCDate(end.getUTCDate() + 6);
    return { start: key(date), end: key(end) };
  }
  if (period === 'month') return { start: key(new Date(Date.UTC(year, month, 1))), end: anchor };
  if (period === 'monthly') return { start: key(new Date(Date.UTC(year, month, 1))), end: key(new Date(Date.UTC(year, month + 1, 0))) };
  if (period === 'biannual') {
    const firstMonth = month < 6 ? 0 : 6;
    return { start: key(new Date(Date.UTC(year, firstMonth, 1))), end: key(new Date(Date.UTC(year, firstMonth + 6, 0))) };
  }
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}
