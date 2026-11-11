import { format, isValid, parseISO } from 'date-fns';

type TimestampLike = {
  toDate?: unknown;
  seconds?: unknown;
  nanoseconds?: unknown;
  _seconds?: unknown;
  _nanoseconds?: unknown;
};

export function normalizeDateValue(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    if (typeof value === 'string') {
      const text = value.trim();
      if (!text || /^[+-]?\d{1,3}$/.test(text)) return null;
      // Native parsing can roll impossible ISO calendar dates into the next month.
      if (/^\d{4}-\d{2}-\d{2}/.test(text) && !isValid(parseISO(text))) return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === 'object') {
    const timestamp = value as TimestampLike;
    if (typeof timestamp.toDate === 'function') {
      try {
        const parsed = timestamp.toDate();
        return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
      } catch {
        return null;
      }
    }

    const seconds = timestamp.seconds ?? timestamp._seconds;
    const nanoseconds = timestamp.seconds != null ? timestamp.nanoseconds : timestamp._nanoseconds;
    if (typeof seconds !== 'number' || !Number.isInteger(seconds)) return null;
    const nanos = nanoseconds === undefined ? 0 : nanoseconds;
    if (typeof nanos !== 'number' || !Number.isInteger(nanos) || nanos < 0 || nanos >= 1_000_000_000) return null;
    const parsed = new Date(seconds * 1000 + Math.floor(nanos / 1_000_000));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

export function formatDateValue(value: unknown, pattern: string, fallback = 'Invalid date'): string {
  const parsed = normalizeDateValue(value);
  return parsed ? format(parsed, pattern) : fallback;
}
