import { BRANCH_SHIFT_NAMES } from './branchShifts';
import type { Branch } from '../types';
import { isBusinessDate } from './eodBusinessDate';
export type EodShift = { id: string; name: string; startTime: string; endTime: string };
const labels: Record<string, string> = BRANCH_SHIFT_NAMES;
/** Settings' branch field keys are immutable identifiers, not EOD-specific shifts. */
export function configuredEodShifts(branch: Pick<Branch, 'shifts'> | null | undefined): EodShift[] {
  return Object.entries(branch?.shifts || {}).filter(([, config]) => config?.enabled === true)
    .map(([id, config]) => ({ id, name: labels[id] || id, startTime: config.startTime, endTime: config.endTime }));
}
export function eodIdentity(tenantId: string, branchId: string, date: string, shiftId: string): string {
  if (![tenantId, branchId, shiftId].every(v => typeof v === 'string' && v.length > 0 && v.length <= 200 && !/[~\/]/.test(v)) || !isBusinessDate(date)) {
    throw new Error('A tenant, branch, valid business date and configured shift are required.');
  }
  return `eod~${tenantId}~${branchId}~${date}~${shiftId}`;
}
