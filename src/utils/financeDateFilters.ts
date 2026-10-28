export interface FinanceDateRange { start: string; end: string }

export function financeDateKey(value: unknown): string {
  // Date-only and ISO strings in these ledgers already carry their recorded date.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = value instanceof Date ? value : typeof (value as any)?.toDate === 'function' ? (value as any).toDate() : null;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function inFinanceDateRange(value: unknown, range: FinanceDateRange): boolean {
  if (!range.start && !range.end) return true;
  const key = financeDateKey(value);
  return !!key && (!range.start || key >= range.start) && (!range.end || key <= range.end);
}

/** Seven inclusive Kampala calendar dates, including today. Display default only. */
export function lastSevenFinanceDays(now = new Date()): FinanceDateRange {
  const end = financeDateKey(now);
  const start = new Date(`${end}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 6);
  return { start: start.toISOString().slice(0, 10), end };
}
