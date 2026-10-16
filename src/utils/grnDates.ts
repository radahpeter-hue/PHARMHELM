/** Formats a Central GRN receipt date regardless of historical Firestore storage type. */
export function grnReceivedDateKey(value: unknown): string {
  if (!value) return '';
  const raw = value as { toDate?: () => Date; seconds?: number };
  const date = typeof raw.toDate === 'function' ? raw.toDate()
    : typeof raw.seconds === 'number' ? new Date(raw.seconds * 1000)
      : value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
}
