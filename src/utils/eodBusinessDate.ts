/** Canonical EOD business day. Persisted as reconciliation_date; never derived from submission time. */
export function isBusinessDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

export function kampalaBusinessDate(instant: Date = new Date()): string {
  if (!Number.isFinite(instant.getTime())) throw new Error('Invalid business-day timestamp.');
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Kampala', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(instant);
}

/** Ambiguous timezone-free legacy timestamps cannot establish a business day. */
export function timestampBusinessDate(timestamp: string): string | undefined {
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp || '')) return;
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? kampalaBusinessDate(date) : undefined;
}
