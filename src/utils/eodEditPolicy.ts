import { hasAnyRole } from './roles';
export const EOD_EDIT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
export function eodEditDeadline(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  const start = Date.parse(`${date}T00:00:00+03:00`);
  // Reject impossible dates that JavaScript normalises into a different month.
  if (!Number.isFinite(start) || new Date(start + 3 * 3600000).toISOString().slice(0,10) !== date) return NaN;
  return start + EOD_EDIT_WINDOW_MS;
}
export function canCorrectEod(profile: {role?: string; secondaryRoles?: string[]; tenantId?: string} | null | undefined,
  record: {tenantId: string; reconciliation_date: string}, now = Date.now()): boolean {
  const deadline = eodEditDeadline(record.reconciliation_date);
  return !!profile && profile.tenantId === record.tenantId && hasAnyRole(profile, ['IT Head'])
    && now >= deadline - EOD_EDIT_WINDOW_MS && now < deadline;
}
