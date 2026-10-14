/** Read legacy numeric strings without disguising corrupt balances as zero. */
export function operationalStockQuantity(value: unknown): number | null {
  if (value == null || value === '') return 0;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return 0;
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : null;
}

export function operationalIssueUnit(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const unit = value.trim();
  return unit && /\p{L}/u.test(unit) ? unit : null;
}

export function validateOperationalOpeningStock(value: unknown): number {
  const quantity = operationalStockQuantity(value);
  if (quantity === null) throw new Error('Opening stock must be a finite, non-negative quantity.');
  return quantity;
}
