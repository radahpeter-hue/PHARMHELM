import { OperationalInventory } from '../types';

export function validateOperationalUsage(item: Pick<OperationalInventory, 'inventoryClass' | 'operationalType' | 'type' | 'quantityInStock'>, quantity: number): void {
  const operationalType = item.operationalType || (item.type === 'fixed' ? 'FIXED_ASSET' : 'CONSUMABLE_OPERATIONAL');
  if (item.inventoryClass !== 'OPERATIONAL') throw new Error('Usage can only be logged against Operational Inventory.');
  if (operationalType !== 'CONSUMABLE_OPERATIONAL') throw new Error('Fixed assets cannot be issued as consumable Operational Inventory.');
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Enter a positive usage quantity.');
  if (quantity > Number(item.quantityInStock || 0)) throw new Error('Usage quantity exceeds Operational stock on hand.');
}

export function calculateOperationalUsage(item: Pick<OperationalInventory, 'inventoryClass' | 'operationalType' | 'type' | 'quantityInStock' | 'costPerPack' | 'unitPerPack'>, quantity: number) {
  validateOperationalUsage(item, quantity);
  const unitCostUGX = Number(item.costPerPack || 0) / Math.max(1, Number(item.unitPerPack || 1));
  return { unitCostUGX, totalCostUGX: quantity * unitCostUGX, remainingStock: Number(item.quantityInStock || 0) - quantity };
}
