import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLegacySellingTierMirror, validateSellingTierConfiguration } from '../src/services/sellingTierConfigurationService';
import type { Product } from '../src/types';

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'p1',
  tenantId: 't1',
  productId: 'PRD-1',
  sku: 'SKU-1',
  name: 'Example',
  category: 'drug/medicine',
  costPricePerPack: 1000,
  sellingPricePerUnit: 100,
  taxExempt: true,
  taxRate: 0,
  unitsPerPack: 100,
  unitsPerStrip: 10,
  unit: 'tablet',
  baseUnit: 'tablet',
  dosageForm: 'Tablet',
  unitOfSell: 'unit',
  ...overrides
});

test('valid enabled tiers require explicit prices and an enabled default', () => {
  const errors = validateSellingTierConfiguration(product({
    sellingTiers: {
      unit: { enabled: true, price: 300 },
      strip: { enabled: true, price: 2500 },
      pack: { enabled: true, price: 22000 }
    },
    defaultSellingTierCode: 'strip'
  }));
  assert.deepEqual(errors, []);
});

test('strip and pack packaging multipliers are enforced only when those tiers are enabled', () => {
  const noStripError = validateSellingTierConfiguration(product({
    unitsPerStrip: undefined,
    sellingTiers: { unit: { enabled: true, price: 300 } },
    defaultSellingTierCode: 'unit'
  }));
  assert.deepEqual(noStripError, []);

  const stripError = validateSellingTierConfiguration(product({
    unitsPerStrip: undefined,
    sellingTiers: { strip: { enabled: true, price: 2500 } },
    defaultSellingTierCode: 'strip'
  }));
  assert.ok(stripError.some(error => error.includes('Units per Strip')));
});

test('default tier must be enabled', () => {
  const errors = validateSellingTierConfiguration(product({
    sellingTiers: {
      unit: { enabled: true, price: 300 },
      strip: { enabled: false, price: 2500 }
    },
    defaultSellingTierCode: 'strip'
  }));
  assert.ok(errors.some(error => error.includes('default selling tier')));
});

test('legacy compatibility preserves unitOfSell and keeps sellingPricePerUnit a true base-unit price', () => {
  const updated = applyLegacySellingTierMirror(product({
    unitOfSell: 'unit',
    sellingPricePerUnit: 100,
    sellingTiers: {
      unit: { enabled: true, price: 300 },
      strip: { enabled: true, price: 2500 }
    },
    defaultSellingTierCode: 'strip'
  }));
  assert.equal(updated.unitOfSell, 'unit');
  assert.equal(updated.sellingPricePerUnit, 300);
  assert.equal(updated.sellingTierSchemaVersion, 1);
  assert.equal(updated.sellingTiers?.pack, undefined);
});

test('strip or pack commercial prices never overwrite sellingPricePerUnit when Unit tier is disabled', () => {
  const updated = applyLegacySellingTierMirror(product({
    unitOfSell: 'strip',
    sellingPricePerUnit: 175,
    sellingTiers: {
      strip: { enabled: true, price: 2500 },
      pack: { enabled: true, price: 22000 }
    },
    defaultSellingTierCode: 'pack'
  }));
  assert.equal(updated.unitOfSell, 'strip');
  assert.equal(updated.sellingPricePerUnit, 175);
  assert.notEqual(updated.sellingPricePerUnit, 2500);
  assert.notEqual(updated.sellingPricePerUnit, 22000);
});
