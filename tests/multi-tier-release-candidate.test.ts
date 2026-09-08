import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Product, ProductBatch, SaleItem } from '../src/types';
import {
  getMultiTierEligibility,
  resolveRequestedSellingTier,
  resolveSellingTiers
} from '../src/services/sellingTierService';
import {
  applyLegacySellingTierMirror,
  validateSellingTierConfiguration
} from '../src/services/sellingTierConfigurationService';
import {
  buildTierCartItem,
  getCartLineIdentity,
  getProductUsableBaseStock,
  getReservedBaseQuantityForProduct,
  mergeTierCartItem,
  replaceTierCartPrice,
  replaceTierCartQuantity
} from '../src/services/posTierCartService';
import {
  allocateFefoCheckoutLines,
  assertCheckoutLineCostFloors,
  buildCheckoutLineDemands,
  finalizeCheckoutSaleItems,
  getCheckoutBatchDeductions,
  getCheckoutProductDeductions
} from '../src/services/posCheckoutTierService';

const enabledSettings = { features: { multiTierSellingEnabled: true } };
const disabledSettings = { features: { multiTierSellingEnabled: false } };

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'p1',
  tenantId: 't1',
  productId: 'PRD-1',
  sku: 'SKU-1',
  name: 'Panadol 500 mg',
  category: 'drug/medicine',
  costPricePerPack: 12000,
  sellingPricePerUnit: 300,
  taxExempt: true,
  taxRate: 0,
  unitsPerPack: 100,
  unitsPerStrip: 10,
  unit: 'tablet',
  baseUnit: 'tablet',
  dosageForm: 'Tablet',
  unitOfSell: 'strip',
  stock: 500,
  sellingTiers: {
    unit: { enabled: true, price: 300 },
    strip: { enabled: true, price: 2500 },
    pack: { enabled: true, price: 22000 }
  },
  defaultSellingTierCode: 'strip',
  ...overrides
});

const batch = (overrides: Partial<ProductBatch> = {}): ProductBatch => ({
  id: 'b1',
  tenantId: 't1',
  productId: 'p1',
  branchId: 'br1',
  quantity: 100,
  expiryDate: '2027-01-31',
  batchNumber: 'A',
  purchasePrice: 100,
  sellingPrice: 300,
  batch_status: 'active',
  ...overrides
});

const makeTierLine = (
  code: 'unit' | 'strip' | 'pack',
  commercialQuantity: number,
  p: Product = product(),
  batches: ProductBatch[] = [batch({ quantity: 500 })]
): SaleItem => buildTierCartItem({
  product: p,
  tier: resolveRequestedSellingTier(p, enabledSettings, code),
  batches,
  tenantId: p.tenantId,
  branchId: 'br1',
  commercialQuantity
});

test('release candidate: tablets expose Unit, Strip and Pack with exact multipliers and prices', () => {
  const p = product();
  const resolution = resolveSellingTiers(p, enabledSettings);
  assert.equal(resolution.mode, 'multi-tier');
  assert.deepEqual(
    resolution.tiers.map(tier => [tier.code, tier.multiplier, tier.configuredPrice]),
    [['unit', 1, 300], ['strip', 10, 2500], ['pack', 100, 22000]]
  );
  assert.equal(resolution.defaultTier.code, 'strip');
});

test('release candidate: non-tablet discrete Unit → Strip → Pack products are eligible', () => {
  const lozenge = product({
    id: 'p2', productId: 'PRD-2', sku: 'SKU-2', name: 'Throat Lozenge',
    dosageForm: 'Lozenge', unit: 'lozenge', baseUnit: 'lozenge', unitsPerStrip: 8, unitsPerPack: 48,
    sellingTiers: {
      unit: { enabled: true, price: 500 },
      strip: { enabled: true, price: 3500 },
      pack: { enabled: true, price: 19000 }
    },
    defaultSellingTierCode: 'strip'
  });
  assert.deepEqual(getMultiTierEligibility(lozenge), { eligible: true, reason: 'unit-strip-pack-hierarchy' });
  assert.equal(resolveSellingTiers(lozenge, enabledSettings).mode, 'multi-tier');
});

test('release candidate: pack-as-base-unit products do not enter multi-tier mode', () => {
  const packOnly = product({ dosageForm: 'Other', unit: 'pack', baseUnit: 'pack', unitsPerStrip: 10, unitsPerPack: 100 });
  assert.equal(getMultiTierEligibility(packOnly).eligible, false);
  assert.equal(resolveSellingTiers(packOnly, enabledSettings).mode, 'legacy');
});

test('release candidate: invalid configuration cannot save enabled Strip or Pack silently', () => {
  const errors = validateSellingTierConfiguration(product({
    unitsPerStrip: undefined,
    sellingTiers: {
      strip: { enabled: true, price: 2500 },
      pack: { enabled: true, price: 22000 }
    },
    defaultSellingTierCode: 'strip'
  }));
  assert.ok(errors.some(error => error.includes('Units per Strip')));
});

test('release candidate: legacy mirror follows only the configured default tier', () => {
  const mirrored = applyLegacySellingTierMirror(product());
  assert.equal(mirrored.unitOfSell, 'strip');
  assert.equal(mirrored.sellingPricePerUnit, 2500);
});

test('release candidate: Unit, Strip and Pack remain three distinct commercial cart lines', () => {
  const p = product();
  const batches = [batch({ quantity: 300 })];
  let cart: SaleItem[] = [];
  cart = mergeTierCartItem(cart, makeTierLine('unit', 1, p, batches));
  cart = mergeTierCartItem(cart, makeTierLine('strip', 1, p, batches));
  cart = mergeTierCartItem(cart, makeTierLine('pack', 1, p, batches));
  assert.equal(cart.length, 3);
  assert.equal(new Set(cart.map(getCartLineIdentity)).size, 3);
  assert.equal(getReservedBaseQuantityForProduct(cart, p.id), 111);
});

test('release candidate: identical tier terms merge while preserving commercial and base quantities', () => {
  const p = product();
  const batches = [batch({ quantity: 100 })];
  const strip = makeTierLine('strip', 1, p, batches);
  const cart = mergeTierCartItem(mergeTierCartItem([], strip), strip);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].commercialQuantity, 2);
  assert.equal(cart[0].baseQuantity, 20);
  assert.equal(cart[0].lineTotal, 5000);
});

test('release candidate: expired and inactive batches are excluded from usable cart stock', () => {
  const batches = [
    batch({ id: 'expired', quantity: 90, expiryDate: '2026-01-31' }),
    batch({ id: 'quarantine', quantity: 80, batch_status: 'quarantined', expiryDate: '2027-01-31' }),
    batch({ id: 'usable', quantity: 17, expiryDate: '2027-03-31' })
  ];
  assert.equal(getProductUsableBaseStock(batches, 'p1', new Date('2026-09-08T12:00:00Z')), 17);
});

test('release candidate: cart quantity cannot exceed total usable base stock across tiers', () => {
  const p = product();
  const batches = [batch({ quantity: 25 })];
  const unit = makeTierLine('unit', 5, p, batches);
  const strip = makeTierLine('strip', 1, p, batches);
  let cart = mergeTierCartItem(mergeTierCartItem([], unit), strip);
  const stripIdentity = getCartLineIdentity(cart.find(item => item.tierCode === 'strip')!);
  cart = replaceTierCartQuantity({ cart, targetIdentity: stripIdentity, product: p, batches, commercialQuantity: 2 });
  assert.equal(getReservedBaseQuantityForProduct(cart, 'p1'), 25);
  assert.throws(
    () => replaceTierCartQuantity({ cart, targetIdentity: stripIdentity, product: p, batches, commercialQuantity: 3 }),
    /Insufficient stock/
  );
});

test('release candidate: manual price override is preserved as an explicit snapshot', () => {
  const p = product();
  const line = makeTierLine('strip', 2, p, [batch({ quantity: 40 })]);
  const identity = getCartLineIdentity(line);
  const [updated] = replaceTierCartPrice({ cart: [line], targetIdentity: identity, actualUnitPrice: 2400 });
  assert.equal(updated.configuredPrice, 2500);
  assert.equal(updated.actualUnitPrice, 2400);
  assert.equal(updated.unitPrice, 2400);
  assert.equal(updated.lineTotal, 4800);
  assert.equal(updated.priceSource, 'manual-override');
});

test('release candidate: checkout resolves all three tiers of one product into exact base demand', () => {
  const p = product();
  const items = [makeTierLine('unit', 2, p), makeTierLine('strip', 3, p), makeTierLine('pack', 1, p)];
  const demands = buildCheckoutLineDemands({
    items,
    liveProducts: new Map([[p.id, p]]),
    settings: enabledSettings,
    tenantId: 't1',
    branchId: 'br1'
  });
  assert.deepEqual(demands.map(demand => demand.baseQuantity), [2, 30, 100]);
  assert.equal(getCheckoutProductDeductions(demands).get('p1'), 132);
});

test('release candidate: checkout rejects tenant and branch basket mismatches', () => {
  const p = product();
  const line = makeTierLine('strip', 1, p);
  assert.throws(() => buildCheckoutLineDemands({
    items: [{ ...line, tenantId: 'other' }], liveProducts: new Map([[p.id, p]]), settings: enabledSettings,
    tenantId: 't1', branchId: 'br1'
  }), /tenant mismatch/);
  assert.throws(() => buildCheckoutLineDemands({
    items: [{ ...line, branchId: 'br2' }], liveProducts: new Map([[p.id, p]]), settings: enabledSettings,
    tenantId: 't1', branchId: 'br1'
  }), /different branch/);
});

test('release candidate: checkout rejects a tier disabled after the product entered the basket', () => {
  const p = product();
  const line = makeTierLine('strip', 1, p);
  const live = product({
    sellingTiers: {
      unit: { enabled: true, price: 300 },
      strip: { enabled: false, price: 2500 },
      pack: { enabled: true, price: 22000 }
    },
    defaultSellingTierCode: 'unit'
  });
  assert.throws(() => buildCheckoutLineDemands({
    items: [line], liveProducts: new Map([[live.id, live]]), settings: enabledSettings,
    tenantId: 't1', branchId: 'br1'
  }), /no longer enabled/);
});

test('release candidate: checkout rejects changed packaging, changed configured price and inconsistent base snapshot', () => {
  const p = product();
  const line = makeTierLine('strip', 2, p);
  assert.throws(() => buildCheckoutLineDemands({
    items: [line], liveProducts: new Map([[p.id, product({ unitsPerStrip: 12 })]]), settings: enabledSettings,
    tenantId: 't1', branchId: 'br1'
  }), /packaging changed/);
  assert.throws(() => buildCheckoutLineDemands({
    items: [line], liveProducts: new Map([[p.id, product({ sellingTiers: { ...p.sellingTiers, strip: { enabled: true, price: 2600 } } })]]),
    settings: enabledSettings, tenantId: 't1', branchId: 'br1'
  }), /configured price changed/);
  assert.throws(() => buildCheckoutLineDemands({
    items: [{ ...line, baseQuantity: 19 }], liveProducts: new Map([[p.id, p]]), settings: enabledSettings,
    tenantId: 't1', branchId: 'br1'
  }), /inconsistent/);
});

test('release candidate: FEFO partitions mixed-tier demand without double-allocating the same stock', () => {
  const p = product();
  const items = [makeTierLine('strip', 1, p), makeTierLine('unit', 2, p), makeTierLine('pack', 1, p)];
  const demands = buildCheckoutLineDemands({
    items, liveProducts: new Map([[p.id, p]]), settings: enabledSettings, tenantId: 't1', branchId: 'br1'
  });
  const allocations = allocateFefoCheckoutLines({
    demands,
    productNames: new Map([[p.id, p.name]]),
    batchesByProduct: new Map([[p.id, [
      { id: 'b1', tenantId: 't1', branchId: 'br1', productId: 'p1', batchNumber: 'A', expiryDate: '2027-01-01', quantity: 6, costPerBaseUnit: 100 },
      { id: 'b2', tenantId: 't1', branchId: 'br1', productId: 'p1', batchNumber: 'B', expiryDate: '2027-02-01', quantity: 30, costPerBaseUnit: 120 },
      { id: 'b3', tenantId: 't1', branchId: 'br1', productId: 'p1', batchNumber: 'C', expiryDate: '2027-06-01', quantity: 100, costPerBaseUnit: 130 }
    ]]])
  });

  assert.deepEqual(allocations[0].allocations.map(a => [a.batchId, a.baseQuantity]), [['b1', 6], ['b2', 4]]);
  assert.deepEqual(allocations[1].allocations.map(a => [a.batchId, a.baseQuantity]), [['b2', 2]]);
  assert.deepEqual(allocations[2].allocations.map(a => [a.batchId, a.baseQuantity]), [['b2', 24], ['b3', 76]]);
  assert.equal(getCheckoutBatchDeductions(allocations).get('p1')?.get('b1'), 6);
  assert.equal(getCheckoutBatchDeductions(allocations).get('p1')?.get('b2'), 30);
  assert.equal(getCheckoutBatchDeductions(allocations).get('p1')?.get('b3'), 76);
});

test('release candidate: two products cannot consume each other\'s batches', () => {
  const p1 = product();
  const p2 = product({ id: 'p2', productId: 'PRD-2', sku: 'SKU-2', name: 'Amoxicillin 500 mg' });
  const item1 = makeTierLine('strip', 1, p1, [batch({ productId: 'p1', quantity: 10 })]);
  const item2 = makeTierLine('strip', 1, p2, [batch({ id: 'p2b', productId: 'p2', quantity: 10 })]);
  const demands = buildCheckoutLineDemands({
    items: [item1, item2], liveProducts: new Map([[p1.id, p1], [p2.id, p2]]), settings: enabledSettings,
    tenantId: 't1', branchId: 'br1'
  });
  const allocations = allocateFefoCheckoutLines({
    demands,
    batchesByProduct: new Map([
      ['p1', [{ id: 'b1', tenantId: 't1', branchId: 'br1', productId: 'p1', batchNumber: 'A', expiryDate: '2027-01-01', quantity: 10, costPerBaseUnit: 100 }]],
      ['p2', [{ id: 'p2b', tenantId: 't1', branchId: 'br1', productId: 'p2', batchNumber: 'B', expiryDate: '2027-01-01', quantity: 10, costPerBaseUnit: 90 }]]
    ])
  });
  assert.equal(allocations[0].allocations[0].batchId, 'b1');
  assert.equal(allocations[1].allocations[0].batchId, 'p2b');
});

test('release candidate: insufficient aggregate FEFO stock fails before finalization', () => {
  const p = product();
  const items = [makeTierLine('strip', 2, p, [batch({ quantity: 30 })])];
  const demands = buildCheckoutLineDemands({
    items, liveProducts: new Map([[p.id, p]]), settings: enabledSettings, tenantId: 't1', branchId: 'br1'
  });
  assert.throws(() => allocateFefoCheckoutLines({
    demands,
    productNames: new Map([[p.id, p.name]]),
    batchesByProduct: new Map([[p.id, [
      { id: 'b1', tenantId: 't1', branchId: 'br1', productId: 'p1', batchNumber: 'A', expiryDate: '2027-01-01', quantity: 12, costPerBaseUnit: 100 }
    ]]])
  }), /Missing 8 base units/);
});

test('release candidate: below-cost protection is line-specific after FEFO and discount', () => {
  const p = product();
  const strip = makeTierLine('strip', 1, p);
  const unit = makeTierLine('unit', 1, p);
  const demands = buildCheckoutLineDemands({
    items: [strip, unit], liveProducts: new Map([[p.id, p]]), settings: enabledSettings, tenantId: 't1', branchId: 'br1'
  });
  const allocations = allocateFefoCheckoutLines({
    demands,
    batchesByProduct: new Map([[p.id, [
      { id: 'b1', tenantId: 't1', branchId: 'br1', productId: 'p1', batchNumber: 'A', expiryDate: '2027-01-01', quantity: 20, costPerBaseUnit: 220 }
    ]]])
  });
  assert.doesNotThrow(() => assertCheckoutLineCostFloors({ items: [strip, unit], allocations, discountPercentage: 0 }));
  assert.throws(() => assertCheckoutLineCostFloors({ items: [strip, unit], allocations, discountPercentage: 20 }), /below the actual allocated batch cost/);
});

test('release candidate: finalized receipt lines retain exact commercial, base and batch allocation snapshots', () => {
  const p = product();
  const items = [makeTierLine('strip', 1, p), makeTierLine('unit', 2, p)];
  const demands = buildCheckoutLineDemands({
    items, liveProducts: new Map([[p.id, p]]), settings: enabledSettings, tenantId: 't1', branchId: 'br1'
  });
  const allocations = allocateFefoCheckoutLines({
    demands,
    batchesByProduct: new Map([[p.id, [
      { id: 'b1', tenantId: 't1', branchId: 'br1', productId: 'p1', batchNumber: 'A', expiryDate: '2027-01-01', quantity: 6, costPerBaseUnit: 100 },
      { id: 'b2', tenantId: 't1', branchId: 'br1', productId: 'p1', batchNumber: 'B', expiryDate: '2027-06-01', quantity: 20, costPerBaseUnit: 120 }
    ]]])
  });
  const finalized = finalizeCheckoutSaleItems(items, allocations);
  assert.equal(finalized[0].commercialQuantity, 1);
  assert.equal(finalized[0].baseQuantity, 10);
  assert.equal(finalized[0].batchNumber, 'FEFO-MULTI');
  assert.deepEqual(finalized[0].batchAllocations?.map(a => [a.batchId, a.baseQuantity]), [['b1', 6], ['b2', 4]]);
  assert.equal(finalized[0].actualLineCost, 1080);
  assert.equal(finalized[1].commercialQuantity, 2);
  assert.equal(finalized[1].baseQuantity, 2);
  assert.equal(finalized[1].batchNumber, 'B');
});

test('release candidate: service lines are ignored by stock demand and preserve their sale line', () => {
  const p = product();
  const stockLine = makeTierLine('unit', 1, p);
  const service: SaleItem = {
    productId: 'svc1', batchId: 'N/A', name: 'Consultation', productName: 'Consultation', quantity: 1,
    unitPrice: 5000, total: 5000, subtotal: 5000, costPrice: 0, batchNumber: 'N/A', isService: true
  };
  const demands = buildCheckoutLineDemands({
    items: [service, stockLine], liveProducts: new Map([[p.id, p]]), settings: enabledSettings,
    tenantId: 't1', branchId: 'br1'
  });
  assert.equal(demands.length, 1);
  assert.equal(demands[0].lineIndex, 1);
  const allocations = allocateFefoCheckoutLines({
    demands,
    batchesByProduct: new Map([[p.id, [{ id: 'b1', tenantId: 't1', branchId: 'br1', productId: 'p1', batchNumber: 'A', expiryDate: '2027-01-01', quantity: 5, costPerBaseUnit: 100 }]]])
  });
  const finalized = finalizeCheckoutSaleItems([service, stockLine], allocations);
  assert.deepEqual(finalized[0], service);
});

test('release candidate: fractional commercial quantities are rejected for discrete tiers', () => {
  const line = makeTierLine('strip', 1);
  assert.throws(() => buildCheckoutLineDemands({
    items: [{ ...line, quantity: 1.5, commercialQuantity: 1.5, baseQuantity: 15 }],
    liveProducts: new Map([['p1', product()]]), settings: enabledSettings, tenantId: 't1', branchId: 'br1'
  }), /positive whole commercial quantity/);
});

test('release candidate: feature flag OFF keeps legacy multiplier behaviour', () => {
  const p = product();
  assert.equal(resolveSellingTiers(p, disabledSettings).mode, 'legacy');
  const legacy: SaleItem = {
    productId: 'p1', batchId: 'b1', name: p.name, productName: p.name, quantity: 2,
    unitPrice: 2500, total: 5000, subtotal: 5000, costPrice: 1000, batchNumber: 'A', isService: false
  };
  const demands = buildCheckoutLineDemands({
    items: [legacy], liveProducts: new Map([[p.id, p]]), settings: disabledSettings, tenantId: 't1', branchId: 'br1'
  });
  assert.equal(demands[0].baseQuantity, 20);
  assert.equal(demands[0].tierMultiplier, 10);
});

test('release candidate: source-level transaction guards and historical consumption snapshots remain present', () => {
  const sales = readFileSync(new URL('../src/pages/Sales.tsx', import.meta.url), 'utf8');
  const consumption = readFileSync(new URL('../src/services/consumptionService.ts', import.meta.url), 'utf8');
  const integrity = readFileSync(new URL('../src/services/saleInventoryIntegrityService.ts', import.meta.url), 'utf8');

  assert.ok(sales.includes('if (existingSale.exists())'));
  assert.ok(sales.includes('Complete every read before the first write'));
  assert.ok(sales.includes('buildCheckoutLineDemands'));
  assert.ok(sales.includes('allocateFefoCheckoutLines'));
  assert.ok(sales.includes('finalizeCheckoutSaleItems'));
  assert.ok(sales.includes('getCheckoutBatchDeductions'));
  assert.ok(consumption.includes('const explicitBaseQuantity = Number(item.baseQuantity)'));
  assert.ok(consumption.includes('Tier-aware sales always use the immutable sale-line baseQuantity/tierMultiplier snapshot'));
  assert.ok(integrity.includes('Multi-tier receipt inventory revisions require exact batch-allocation support'));
  assert.ok(integrity.includes('Multi-tier receipt voiding requires exact stored batch-allocation restoration'));
});
