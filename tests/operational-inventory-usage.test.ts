import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateOperationalUsage } from '../src/services/operationalInventoryUsagePolicy';

const consumable = {
  inventoryClass: 'OPERATIONAL' as const,
  operationalType: 'CONSUMABLE_OPERATIONAL' as const,
  type: 'non-fixed' as const,
  quantityInStock: 25,
  costPerPack: 12000,
  unitPerPack: 12
};

test('consumable usage calculates analytics cost from GRN-derived item cost without changing expense timing', () => {
  assert.deepEqual(calculateOperationalUsage(consumable, 5), {
    unitCostUGX: 1000,
    totalCostUGX: 5000,
    remainingStock: 20
  });
});

test('usage rejects Sellable items, fixed assets, zero quantities and quantities above stock', () => {
  assert.throws(() => calculateOperationalUsage({ ...consumable, inventoryClass: 'SELLABLE' } as any, 1), /Operational Inventory/);
  assert.throws(() => calculateOperationalUsage({ ...consumable, operationalType: 'FIXED_ASSET', type: 'fixed' } as any, 1), /Fixed assets/);
  assert.throws(() => calculateOperationalUsage(consumable, 0), /positive usage quantity/);
  assert.throws(() => calculateOperationalUsage(consumable, 26), /exceeds Operational stock/);
});

test('usage persistence is atomic and does not post a second Finance expense', () => {
  const service = readFileSync(new URL('../src/services/operationalInventoryUsageService.ts', import.meta.url), 'utf8');
  assert.match(service, /runTransaction\(db/);
  assert.match(service, /transaction\.update\(itemRef/);
  assert.match(service, /transaction\.set\(movementRef/);
  assert.match(service, /transaction\.set\(usageRef/);
  assert.doesNotMatch(service, /finance_ledger|entry_type:\s*['"]expense['"]/);
});

test('Firestore rules tie usage records and USAGE movements to the same Operational item and transaction', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const usageRule = rules.slice(rules.indexOf('match /operational_inventory_usage/'), rules.indexOf('match /operational_inventory_maintenance/'));
  assert.match(usageRule, /inventoryClass == 'OPERATIONAL'/);
  assert.match(usageRule, /operationalType == 'CONSUMABLE_OPERATIONAL'/);
  assert.match(usageRule, /existsAfter\([\s\S]*operational_inventory_movements/);
  assert.match(usageRule, /allow update, delete: if false/);
  assert.match(rules, /function validUsageMovement\(item\)/);
  assert.match(rules, /usage\.issuedAmount == -requestedMap\.quantityDelta/);
});
