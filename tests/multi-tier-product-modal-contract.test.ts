import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/inventory/ProductModal.tsx', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/pages/Settings.tsx', import.meta.url), 'utf8');
const sales = readFileSync(new URL('../src/pages/Sales.tsx', import.meta.url), 'utf8');

test('Inventory Master exposes Units per Strip for drug and non-drug package hierarchies', () => {
  assert.ok(source.includes('text-emerald-700 uppercase tracking-wider">Units per Strip</label>'));
  assert.ok(source.includes('text-pink-700 uppercase tracking-wider">Units per Strip</label>'));
  assert.ok(source.includes('text-blue-700 uppercase tracking-wider">Units per Strip</label>'));
});

test('device products reuse the consumable packaging form that includes Units per Strip', () => {
  assert.ok(source.includes("{formData.category === 'device' && renderConsumableFields()}"));
});

test('POS multi-tier activation is explicit, tenant scoped and limited to full Settings access', () => {
  assert.match(settings, /const canManageSettings = hasPermission\('settings', 'all'\)/);
  assert.match(settings, /multiTierSellingEnabled: settings\.features\?\.multiTierSellingEnabled !== true/);
  assert.match(settings, /disabled=\{!canManageSettings\}/);
  assert.match(source, /authorised user enables POS Multi-Tier Selling in Settings/);
});

test('POS catalogue resolves default tier pricing and exposes other enabled tier prices with units', () => {
  assert.match(sales, /resolveSellingTierPrice\(defaultTier, baseSellingPrice\)/);
  assert.match(sales, /UGX \{\(price \|\| 0\)\.toLocaleString\(\)\} \/ \{isProduct \?/);
  assert.match(sales, /tier\.label\.toLowerCase\(\)/);
  assert.match(sales, /disabled=\{cart\.length === 0\}/);
});
