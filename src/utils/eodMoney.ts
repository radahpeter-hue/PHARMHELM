/**
 * EOD preserves the application's numeric UGX values, including fractional POS
 * amounts. No fixed currency tolerance or whole-shilling rounding is introduced.
 * Four machine-epsilon units at the operands' scale cover representation and
 * subtraction round-off; genuine monetary differences remain nonzero.
 */
export function eodAmountNumber(value: unknown): number {
  const plain = typeof value === 'string' ? value.trim() : value;
  const number = typeof plain === 'number' ? plain
    : typeof plain === 'string' && /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(plain)
      ? Number(plain.replaceAll(',', '')) : NaN;
  if (!Number.isFinite(number)) throw new Error('EOD amounts must be finite numbers.');
  return number === 0 ? 0 : number;
}

/** Neumaier compensated summation avoids accumulating binary round-off per sale. */
export function sumEodAmounts(values: readonly unknown[]): number {
  let sum = 0, correction = 0;
  for (const input of values) {
    const value = eodAmountNumber(input);
    const next = sum + value;
    correction += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
    sum = next;
  }
  return eodAmountNumber(sum + correction);
}

export function eodVariance(declared: unknown, expected: unknown): number {
  const actual = eodAmountNumber(declared), target = eodAmountNumber(expected);
  const difference = actual - target;
  const roundoff = 4 * Number.EPSILON * Math.max(Math.abs(actual), Math.abs(target));
  return Math.abs(difference) <= roundoff ? 0 : difference;
}

export function requiresEodVarianceReason(channels: { declared: number; expected: number }[]): boolean {
  return channels.some(c => eodVariance(c.declared, c.expected) !== 0);
}

export function formatEodAmount(value: number, locale = 'en-UG'): string {
  return (value === 0 ? 0 : value).toLocaleString(locale, { maximumSignificantDigits: 15 });
}

export function eodRecordVariance(record: { total_actual?: number | string; total_expected?: number | string; total_variance?: number }): number {
  if (record.total_actual != null && record.total_expected != null) {
    return eodVariance(record.total_actual!, record.total_expected!);
  }
  const variance = record.total_variance ?? 0;
  return variance === 0 ? 0 : variance;
}
