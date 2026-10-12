export type InventoryClass = 'SELLABLE' | 'OPERATIONAL';
export type OperationalInventoryType = 'CONSUMABLE_OPERATIONAL' | 'FIXED_ASSET';

export type LegacyOrderCategory =
  | 'sellable_non_cosmetic'
  | 'sellable_cosmetic'
  | 'non_sellable';

export function inventoryClassForOrderCategory(category: LegacyOrderCategory): InventoryClass {
  return category === 'non_sellable' ? 'OPERATIONAL' : 'SELLABLE';
}

export function operationalTypeForLegacyType(type: 'fixed' | 'non-fixed'): OperationalInventoryType {
  return type === 'fixed' ? 'FIXED_ASSET' : 'CONSUMABLE_OPERATIONAL';
}

export function isOperationalInventoryRecord(data: {
  inventoryClass?: InventoryClass;
  category?: string;
  isOperational?: boolean;
}): boolean {
  return data.inventoryClass === 'OPERATIONAL' || data.category === 'non_sellable' || data.isOperational === true;
}

export function operationalInventoryEnabledFromSettings(
  tenantId: string | undefined,
  settings: { tenantId?: string; featureToggles?: { enableOperationalInventory?: boolean } } | null | undefined
): boolean {
  return Boolean(
    tenantId &&
    settings?.tenantId === tenantId &&
    settings.featureToggles?.enableOperationalInventory === true
  );
}

export function itemMatchesInventoryClass(
  item: { inventoryClass?: InventoryClass; operationalType?: OperationalInventoryType },
  expectedClass: InventoryClass
): boolean {
  if (item.inventoryClass !== expectedClass) return false;
  return expectedClass !== 'OPERATIONAL' || Boolean(item.operationalType);
}

export function orderLinesMatchInventoryClass<T extends { inventoryClass?: InventoryClass }>(
  inventoryClass: InventoryClass,
  lines: T[]
): boolean {
  return lines.length > 0 && lines.every(line => line.inventoryClass === inventoryClass);
}

export interface OperationalOrderFulfillmentPlan {
  requestedPacks: number;
  internalPacks: number;
  externalPacks: number;
  internalIssueUnits: number;
}

export function planOperationalOrderFulfillment(input: {
  orderedPacks: number;
  internalPacks: number;
  hqIssueUnits: number;
  unitsPerPack: number;
}): OperationalOrderFulfillmentPlan {
  const { orderedPacks, internalPacks, hqIssueUnits, unitsPerPack } = input;
  if (![orderedPacks, internalPacks, hqIssueUnits, unitsPerPack].every(Number.isFinite) ||
      orderedPacks <= 0 || !Number.isInteger(orderedPacks) || internalPacks <= 0 || !Number.isInteger(internalPacks) ||
      hqIssueUnits < 0 || !Number.isInteger(hqIssueUnits) || unitsPerPack <= 0 || !Number.isInteger(unitsPerPack)) {
    throw new Error('Operational order quantities must be positive whole packs and issue units.');
  }
  if (internalPacks > orderedPacks) throw new Error('Internal fulfilment cannot exceed the requested quantity.');
  const internalIssueUnits = internalPacks * unitsPerPack;
  if (internalIssueUnits > hqIssueUnits) throw new Error('HQ Operational stock is insufficient for the selected fulfilment quantity.');
  return {
    requestedPacks: orderedPacks,
    internalPacks,
    externalPacks: orderedPacks - internalPacks,
    internalIssueUnits
  };
}
