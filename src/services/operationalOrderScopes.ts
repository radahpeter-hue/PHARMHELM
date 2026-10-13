export type OperationalOrderCategory = 'sellable_non_cosmetic' | 'sellable_cosmetic' | 'non_sellable';

export const SELLABLE_PRODUCT_SCOPES = [
  'drug/medicine',
  'cosmetic',
  'consumable',
  'device',
  'cosmetic therapeutics'
] as const;

export const OPERATIONAL_PRODUCT_SCOPE = 'operational_inventory';

/** Keep the order's selectable product scopes inside its permanent inventory class. */
export function scopesForOrderCategory(category: OperationalOrderCategory, currentScopes: string[]): string[] {
  if (category === 'non_sellable') return [OPERATIONAL_PRODUCT_SCOPE];
  const sellableScopes = currentScopes.filter(scope =>
    SELLABLE_PRODUCT_SCOPES.includes(scope as typeof SELLABLE_PRODUCT_SCOPES[number])
  );
  return sellableScopes.length ? sellableScopes : ['drug/medicine'];
}

export function isScopeAllowedForOrderCategory(category: OperationalOrderCategory, scope: string): boolean {
  return category === 'non_sellable'
    ? scope === OPERATIONAL_PRODUCT_SCOPE
    : SELLABLE_PRODUCT_SCOPES.includes(scope as typeof SELLABLE_PRODUCT_SCOPES[number]);
}
