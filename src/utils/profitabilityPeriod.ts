import type { FinanceDateRange } from './financeDateFilters';
import { kampalaBusinessDate } from './eodBusinessDate';
import type { DateRangeOption } from '../components/analytics/DateRangePicker';
export type ProfitabilityPeriod = 'today' | 'week' | 'month' | 'monthly' | 'quarterly' | 'biannual' | 'annual';

/** Inclusive Kampala calendar date presets. */
export function profitabilityPeriodRange(period: ProfitabilityPeriod, anchor = kampalaBusinessDate()): FinanceDateRange {
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
  if (period === 'quarterly') {
    const firstMonth = Math.floor(month / 3) * 3;
    return { start: key(new Date(Date.UTC(year, firstMonth, 1))), end: key(new Date(Date.UTC(year, firstMonth + 3, 0))) };
  }
  if (period === 'biannual') {
    const firstMonth = month < 6 ? 0 : 6;
    return { start: key(new Date(Date.UTC(year, firstMonth, 1))), end: key(new Date(Date.UTC(year, firstMonth + 6, 0))) };
  }
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export function analyticsProfitabilityRange(period: Exclude<DateRangeOption, 'Custom Range'>, anchor = kampalaBusinessDate()): FinanceDateRange {
  const date = new Date(`${anchor}T12:00:00Z`);
  if (period === 'Today') return profitabilityPeriodRange('today', anchor);
  if (period === 'Yesterday') {
    date.setUTCDate(date.getUTCDate() - 1);
    return profitabilityPeriodRange('today', date.toISOString().slice(0, 10));
  }
  if (period === 'This Week') return profitabilityPeriodRange('week', anchor);
  if (period === 'Last Week') {
    date.setUTCDate(date.getUTCDate() - 7);
    return profitabilityPeriodRange('week', date.toISOString().slice(0, 10));
  }
  if (period === 'Last Month') {
    date.setUTCDate(0);
    return profitabilityPeriodRange('monthly', date.toISOString().slice(0, 10));
  }
  if (period === 'This Quarter') return profitabilityPeriodRange('quarterly', anchor);
  return profitabilityPeriodRange('month', anchor);
}
