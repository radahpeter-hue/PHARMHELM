import type { BranchShifts } from '../types';
/** Shared Settings vocabulary. EOD reads saved branch definitions, never these editor defaults. */
export const BRANCH_SHIFT_NAMES = { dayShift: 'Day Shift', eveningShift: 'Evening Shift', nightShift: 'Night Shift' } as const;
export const defaultBranchShifts = (): BranchShifts => ({
  dayShift: { enabled: true, startTime: '07:30', endTime: '17:00' },
  eveningShift: { enabled: false, startTime: '17:00', endTime: '22:00' },
  nightShift: { enabled: false, startTime: '22:00', endTime: '07:30' }
});
