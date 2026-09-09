import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/inventory/ProductModal.tsx', import.meta.url), 'utf8');

test('Inventory Master exposes Units per Strip for drug and non-drug package hierarchies', () => {
  assert.ok(source.includes('text-emerald-700 uppercase tracking-wider">Units per Strip</label>'));
  assert.ok(source.includes('text-pink-700 uppercase tracking-wider">Units per Strip</label>'));
  assert.ok(source.includes('text-blue-700 uppercase tracking-wider">Units per Strip</label>'));
});

test('device products reuse the consumable packaging form that includes Units per Strip', () => {
  assert.ok(source.includes("{formData.category === 'device' && renderConsumableFields()}"));
});
