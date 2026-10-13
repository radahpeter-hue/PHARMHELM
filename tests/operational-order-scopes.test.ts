import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isScopeAllowedForOrderCategory, scopesForOrderCategory } from '../src/services/operationalOrderScopes';

test('Operational ordering locks product scope to Operational inventory only', () => {
  assert.deepEqual(scopesForOrderCategory('non_sellable', ['drug/medicine', 'operational_inventory']), ['operational_inventory']);
  assert.equal(isScopeAllowedForOrderCategory('non_sellable', 'drug/medicine'), false);
  assert.equal(isScopeAllowedForOrderCategory('non_sellable', 'operational_inventory'), true);
});

test('Sellable ordering strips Operational scope and defaults safely to medicine', () => {
  assert.deepEqual(scopesForOrderCategory('sellable_non_cosmetic', ['drug/medicine', 'operational_inventory']), ['drug/medicine']);
  assert.deepEqual(scopesForOrderCategory('sellable_cosmetic', ['cosmetic']), ['cosmetic']);
  assert.equal(isScopeAllowedForOrderCategory('sellable_cosmetic', 'operational_inventory'), false);
});

test('HQ Sellable ordering UI is Sellable-only; Operational HQ buffer order is a distinct order path', () => {
  const procurement = readFileSync(new URL('../src/pages/Procurement.tsx', import.meta.url), 'utf8');
  const operationalStore = readFileSync(new URL('../src/components/procurement/OperationalHQStoreTab.tsx', import.meta.url), 'utf8');
  const bufferOrderService = readFileSync(new URL('../src/services/operationalHqBufferOrderService.ts', import.meta.url), 'utf8');
  const autoOrder = readFileSync(new URL('../src/components/inventory/AutoGenerateOrderModal.tsx', import.meta.url), 'utf8');
  const sellableHqScopes = procurement.match(/\['drug\/medicine', 'Drug \/ Medicine'\][\s\S]{0,240}/)?.[0] || '';
  assert.doesNotMatch(sellableHqScopes, /operational_inventory/);
  assert.match(procurement, /inventoryClassLock="SELLABLE"/);
  assert.match(operationalStore, /Order Operational buffer stock/);
  assert.match(bufferOrderService, /buildOperationalHqBufferOrder/);
  assert.match(bufferOrderService, /item\.masterItemId/);
  assert.match(bufferOrderService, /enableOperationalInventory !== true/);
  assert.match(autoOrder, /getFilteredProducts\(\)\.map\(p =>/);
});
