import test from 'node:test';
import assert from 'node:assert/strict';
import type { Product } from '../src/types';
import {
  buildSaleTierSnapshot,
  calculateBaseQuantity,
  getMultiTierEligibility,
  isMultiTierSellingEnabled,
  resolveRequestedSellingTier,
  resolveSellingTiers
} from '../src/services/sellingTierService';

const product = (overrides: Partial<Product> = {}) => ({
  id: 'product-1',
  tenantId: 'tenant-1',
  productId: 'PRD-1',
  sku: 'SKU-1',
  name: 'Test Product',
  category: 'drug/medicine',
  costPricePerPack: 1000,
  sellingPricePerUnit: 100,
  taxExempt: true,
  taxRate: 0,
  unitsPerPack: 100,
  unitsPerStrip: 10,
  unit: 'tablet',
  baseUnit: 'tablet',
  unitOfSell: 'strip',
  ...overrides
} as Product);

const enabledSettings = {
  features: {
    multiTierSellingEnabled: true
  }
};

test('multi-tier feature is disabled unless explicitly enabled', () => {
  assert.equal(isMultiTierSellingEnabled(null), false);
  assert.equal(isMultiTierSellingEnabled({ features: {} }), false);
  assert.equal(isMultiTierSellingEnabled(enabledSettings), true);
});

test('tablets and capsules are eligible even before tier configuration exists', () => {
  assert.deepEqual(getMultiTierEligibility(product({ dosageForm: 'Tablet' })), {
    eligible: true,
    reason: 'tablet-or-capsule'
  });
  assert.deepEqual(getMultiTierEligibility(product({ dosageForm: 'Capsules' })), {
    eligible: true,
    reason: 'tablet-or-capsule'
  });
});

test('other products qualify when they have a real unit-strip-pack hierarchy', () => {
  const lozenge = product({
    dosageForm: 'Lozenge',
    baseUnit: 'lozenge',
    unit: 'lozenge',
    unitsPerStrip: 8,
    unitsPerPack: 48
  });

  assert.deepEqual(getMultiTierEligibility(lozenge), {
    eligible: true,
    reason: 'unit-strip-pack-hierarchy'
  });
});

test('a product whose base unit is itself a pack is not made multi-tier by packaging numbers alone', () => {
  const packBased = product({
    dosageForm: 'Other',
    baseUnit: 'pack',
    unit: 'pack',
    unitsPerStrip: 10,
    unitsPerPack: 100
  });

  assert.deepEqual(getMultiTierEligibility(packBased), {
    eligible: false,
    reason: 'not-eligible'
  });
});

test('feature-off resolution preserves legacy unitOfSell behaviour', () => {
  const result = resolveSellingTiers(product({ unitOfSell: 'strip', unitsPerStrip: 10 }), null);

  assert.equal(result.mode, 'legacy');
  assert.equal(result.defaultTier.code, 'strip');
  assert.equal(result.defaultTier.multiplier, 10);
  assert.equal(result.defaultTier.configuredPrice, null);
  assert.equal(result.defaultTier.priceSource, 'legacy');
});

test('valid configured tiers resolve with explicit prices and the configured default', () => {
  const configured = product({
    dosageForm: 'Tablet',
    sellingTiers: {
      unit: { enabled: true, price: 300 },
      strip: { enabled: true, price: 2500 },
      pack: { enabled: true, price: 22000 }
    },
    defaultSellingTierCode: 'strip'
  });

  const result = resolveSellingTiers(configured, enabledSettings);

  assert.equal(result.mode, 'multi-tier');
  assert.deepEqual(result.tiers.map(tier => [tier.code, tier.multiplier, tier.configuredPrice]), [
    ['unit', 1, 300],
    ['strip', 10, 2500],
    ['pack', 100, 22000]
  ]);
  assert.equal(result.defaultTier.code, 'strip');
});

test('disabled tiers are omitted and invalid prices are never invented', () => {
  const configured = product({
    dosageForm: 'Tablet',
    sellingTiers: {
      unit: { enabled: false, price: 300 },
      strip: { enabled: true, price: 0 },
      pack: { enabled: true, price: 22000 }
    },
    defaultSellingTierCode: 'pack'
  });

  const result = resolveSellingTiers(configured, enabledSettings);

  assert.equal(result.mode, 'multi-tier');
  assert.deepEqual(result.tiers.map(tier => tier.code), ['pack']);
  assert.equal(result.defaultTier.configuredPrice, 22000);
  assert.match(result.warnings.join(' '), /Strip tier is enabled but has no valid configured price/);
});

test('strip and pack tiers cannot resolve without valid packaging multipliers', () => {
  const configured = product({
    dosageForm: 'Tablet',
    unitsPerStrip: 0,
    unitsPerPack: 0,
    sellingTiers: {
      strip: { enabled: true, price: 2500 },
      pack: { enabled: true, price: 22000 }
    },
    defaultSellingTierCode: 'strip'
  });

  const result = resolveSellingTiers(configured, enabledSettings);

  assert.equal(result.mode, 'legacy');
  assert.match(result.warnings.join(' '), /packaging multiplier is missing or invalid/);
});

test('multiple valid tiers without a valid default fall back to legacy rather than guessing', () => {
  const configured = product({
    dosageForm: 'Tablet',
    sellingTiers: {
      unit: { enabled: true, price: 300 },
      strip: { enabled: true, price: 2500 }
    },
    defaultSellingTierCode: 'pack'
  });

  const result = resolveSellingTiers(configured, enabledSettings);

  assert.equal(result.mode, 'legacy');
  assert.match(result.warnings.join(' '), /default tier is missing or invalid/);
});

test('a requested disabled tier is rejected', () => {
  const configured = product({
    dosageForm: 'Tablet',
    sellingTiers: {
      unit: { enabled: true, price: 300 },
      strip: { enabled: true, price: 2500 }
    },
    defaultSellingTierCode: 'strip'
  });

  assert.throws(
    () => resolveRequestedSellingTier(configured, enabledSettings, 'pack'),
    /Pack selling tier is not currently available/
  );
});

test('sale snapshots permanently capture commercial and base-unit meaning', () => {
  const configured = product({
    dosageForm: 'Tablet',
    sellingTiers: {
      strip: { enabled: true, price: 2500 }
    },
    defaultSellingTierCode: 'strip'
  });
  const tier = resolveRequestedSellingTier(configured, enabledSettings, 'strip');

  const snapshot = buildSaleTierSnapshot({
    product: configured,
    tier,
    commercialQuantity: 2,
    actualUnitPrice: 2500,
    taxStatus: 'zero-rated'
  });

  assert.equal(snapshot.tierCode, 'strip');
  assert.equal(snapshot.tierMultiplier, 10);
  assert.equal(snapshot.commercialQuantity, 2);
  assert.equal(snapshot.baseQuantity, 20);
  assert.equal(snapshot.configuredPrice, 2500);
  assert.equal(snapshot.actualUnitPrice, 2500);
  assert.equal(snapshot.lineTotal, 5000);
});

test('fractional commercial quantities are blocked for discrete unit-strip-pack products', () => {
  assert.equal(calculateBaseQuantity(3, 10), 30);
  assert.throws(() => calculateBaseQuantity(1.5, 10), /positive whole number/);
});
