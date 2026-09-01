import { OperationalInventory } from '../types';

/** Identifies the legacy demo rows that older Inventory builds wrote into live tenants. */
export function isLegacyOperationalInventorySeed(item: Partial<OperationalInventory>): boolean {
  return (
    item.name === 'Office Printer (HP LaserJet)' &&
    item.uniqueId === 'PRN-001' &&
    item.supplier === 'Tech Solutions Ltd'
  ) || (
    item.name === 'A4 Printing Paper' &&
    item.supplier === 'Stationery World' &&
    Number(item.costPerPack) === 25000
  ) || (
    item.name === 'Ballpoint Pens (Blue)' &&
    item.supplier === 'Stationery World' &&
    Number(item.costPerPack) === 15000
  );
}
