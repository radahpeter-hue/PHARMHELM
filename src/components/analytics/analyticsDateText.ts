import { normalizeDateValue } from '../../utils/dateValue';

// Keep the calendar date and clock time as stored for existing text-based reports.
export function analyticsDateText(value: unknown): string {
  return typeof value === 'string' ? value : normalizeDateValue(value)?.toISOString() ?? '';
}
