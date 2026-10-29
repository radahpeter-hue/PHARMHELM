import type { Branch } from '../types';
import { configuredEodShifts } from './eodShifts';
import { timestampBusinessDate } from './eodBusinessDate';
export interface PosShiftAttribution {
  version: 1;
  businessDate: string;
  shiftId: string;
  shiftName: string;
  startTime: string;
  endTime: string;
  timeZone: 'Africa/Kampala';
}
const minutes = (value: string): number => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '') ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : NaN;
/** Capture at checkout from the transaction's branch configuration. Never call for historical backfill. */
export function capturePosShift(branch: Pick<Branch, 'shifts'>, timestamp: string): PosShiftAttribution | undefined {
  const calendarDate = timestampBusinessDate(timestamp);
  if (!calendarDate) return;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Kampala', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(timestamp));
  const now = minutes(parts);
  const matches = configuredEodShifts(branch).filter(s => {
    const start = minutes(s.startTime), end = minutes(s.endTime);
    return Number.isFinite(start) && Number.isFinite(end) && start !== end
      && (start < end ? now >= start && now < end : now >= start || now < end);
  });
  // Gaps, overlaps, disabled/missing config must not manufacture a shift.
  if (matches.length !== 1) return;
  const shift = matches[0];
  const overnightPreviousDay = minutes(shift.startTime) > minutes(shift.endTime) && now < minutes(shift.endTime);
  const businessDate = overnightPreviousDay
    ? new Date(Date.parse(`${calendarDate}T12:00:00Z`) - 86400000).toISOString().slice(0, 10)
    : calendarDate;
  return { version: 1, businessDate, shiftId: shift.id, shiftName: shift.name, startTime: shift.startTime, endTime: shift.endTime, timeZone: 'Africa/Kampala' };
}
