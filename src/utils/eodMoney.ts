/**
 * EOD preserves the application's numeric UGX values, including fractional POS
 * amounts. No fixed currency tolerance or whole-shilling rounding is introduced.
 * Four machine-epsilon units at the operands' scale cover representation and
 * subtraction round-off; genuine monetary differences remain nonzero.
 */
export function eodVariance(declared: number, expected: number): number {
  if (!Number.isFinite(declared) || !Number.isFinite(expected)) throw new Error('EOD amounts must be finite numbers.');
  const difference = declared - expected;
  const roundoff = 4 * Number.EPSILON * Math.max(Math.abs(declared), Math.abs(expected));
  return Math.abs(difference) <= roundoff ? 0 : difference;
}

export function requiresEodVarianceReason(channels: { declared: number; expected: number }[]): boolean {
  return channels.some(c => eodVariance(c.declared, c.expected) !== 0);
}
