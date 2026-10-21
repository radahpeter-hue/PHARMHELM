/**
 * Finance V2 EOD calculations. No database writes or financial postings belong here.
 * A shift's business date is the local calendar date on which that shift starts.
 */
export type EodShift = { id: string; enabled: boolean; startTime: string; endTime: string };
export type EodAmounts = Record<string, number>;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function assertUgx(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('EOD amount must be a nonnegative, safe integer UGX value.');
  }
  return value;
}

export function eodVariance(declared: number, expected: number): number {
  assertUgx(declared);
  assertUgx(expected);
  const difference = declared - expected;
  return difference === 0 ? 0 : difference;
}

export function validateEodAmounts(expected: EodAmounts, declared: EodAmounts, reason: string): { variances: EodAmounts; totalVariance: number } {
  const methods = [...new Set([...Object.keys(expected), ...Object.keys(declared)])];
  const variances: EodAmounts = {};
  let totalVariance = 0;
  for (const method of methods) {
    // Validate the source amounts independently. In particular, missing fields
    // are zero but a malformed present field must never silently become zero.
    const expectedAmount = Object.prototype.hasOwnProperty.call(expected, method) ? expected[method] : 0;
    const declaredAmount = Object.prototype.hasOwnProperty.call(declared, method) ? declared[method] : 0;
    const variance = eodVariance(declaredAmount, expectedAmount);
    variances[method] = variance;
    totalVariance += variance;
    if (!Number.isSafeInteger(totalVariance)) throw new Error('EOD total exceeds supported UGX precision.');
  }
  // A net zero can conceal offsetting shortages and surpluses.
  if (Object.values(variances).some(value => value !== 0) && !reason.trim()) {
    throw new Error('A reason is required for every genuine payment-method variance.');
  }
  return { variances, totalVariance: totalVariance === 0 ? 0 : totalVariance };
}

function minutes(time: string): number {
  const match = timePattern.exec(time);
  if (!match) throw new Error('Invalid shift time. Expected HH:mm.');
  return Number(match[1]) * 60 + Number(match[2]);
}

function previousDay(date: string): string {
  if (!datePattern.test(date)) throw new Error('Invalid business date.');
  const utc = new Date(date + 'T00:00:00.000Z');
  if (Number.isNaN(utc.getTime()) || utc.toISOString().slice(0, 10) !== date) throw new Error('Invalid business date.');
  utc.setUTCDate(utc.getUTCDate() - 1);
  return utc.toISOString().slice(0, 10);
}

/** Resolve the calendar date in the branch timezone, not the browser/UTC date. */
export function eodBusinessDateNow(timeZone = 'Africa/Kampala', now = new Date()): string {
  if (Number.isNaN(now.getTime())) throw new Error('Invalid current timestamp.');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function localEodDateTime(timestamp: string, timeZone: string): { date: string; time: string } {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid sale timestamp.');
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const parts = Object.fromEntries(format.formatToParts(date).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/**
 * Returns a single matching shift, or null for a gap.
 * Ambiguous overlapping shifts fail closed rather than silently misassigning sales.
 */
export function assignSaleToEodShift(timestamp: string, shifts: EodShift[], timeZone = 'Africa/Kampala'): { businessDate: string; shiftId: string } | null {
  const local = localEodDateTime(timestamp, timeZone);
  const saleMinute = minutes(local.time);
  const matches: { businessDate: string; shiftId: string }[] = [];
  for (const shift of shifts) {
    if (!shift.enabled) continue;
    const start = minutes(shift.startTime);
    const end = minutes(shift.endTime);
    if (start === end) throw new Error('A zero-length or 24-hour shift requires explicit configuration.');
    const overnight = end < start;
    const included = overnight ? saleMinute >= start || saleMinute < end : saleMinute >= start && saleMinute < end;
    if (included) matches.push({
      businessDate: overnight && saleMinute < end ? previousDay(local.date) : local.date,
      shiftId: shift.id
    });
  }
  if (matches.length > 1) throw new Error('Overlapping shift settings prevent reliable EOD attribution.');
  return matches[0] ?? null;
}

export function eodCanonicalId(tenantId: string, branchId: string, businessDate: string, shiftId: string): string {
  if (!tenantId || !branchId || !datePattern.test(businessDate) || !shiftId) throw new Error('Incomplete EOD identity.');
  // Each segment is length-prefixed to prevent collisions and forbidden Firestore slash characters.
  return [tenantId, branchId, businessDate, shiftId]
    .map(segment => `${segment.length}_${encodeURIComponent(segment).replace(/\./g, '%2E')}`)
    .join('_');
}
