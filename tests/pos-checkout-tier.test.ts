import test from 'node:test';
import assert from 'node:assert/strict';
import type { Product, SaleItem } from '../src/types';
import {
  allocateFefoCheckoutLines,
  assertCheckoutLineCostFloors,
  buildCheckoutLineDemands,
  finalizeCheckoutSaleItems,
  getCheckoutBatchDeductions,
  getCheckoutProductDeductions
} from '../src/services/posCheckoutTierService';

const product: Product = {
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
  sellingTiers: {
    unit: { enabled: true, price: 300 },
    strip: { enabled: true, price: 2500 },
    pack: { enabled: true, price: 22000 }
  },
  defaultSellingTierCode: 'strip'
};

const settings = { features: { multiTierSellingEnabled: true } };

const stripItem: SaleItem = {
  productId: 'p1', batchId: '', name: 'Panadol 500 mg', productName: 'Panadol 500 mg',
  quantity: 1, commercialQuantity: 1, baseQuantity: 10, tierCode: 'strip', tierLabel: 'Strip', tierMultiplier: 10,
  configuredPrice: 2500, actualUnitPrice: 2500, priceSource: 'configured-tier', unitPrice: 2500,
  total: 2500, subtotal: 2500, lineTotal: 2500, costPrice: 1000, batchNumber: 'FEFO-PENDING', isService: false,
  tenantId: 't1', branchId: 'br1'
};

const packItem: SaleItem = {
  ...stripItem,
  quantity: 1, commercialQuantity: 1, baseQuantity: 100, tierCode: 'pack', tierLabel: 'Pack', tierMultiplier: 100,
  configuredPrice: 22000, actualUnitPrice: 22000, unitPrice: 22000, total: 22000, subtotal: 22000, lineTotal: 22000
};

test('checkout resolves base demand per commercial line using live tier configuration', () => {
  const demands = buildCheckoutLineDemands({
    items: [stripItem, packItem], liveProducts: new Map([['p1', product]]), settings, tenantId: 't1', branchId: 'br1'
  });
  assert.deepEqual(demands.map(demand => demand.baseQuantity), [10, 100]);
  assert.equal(getCheckoutProductDeductions(demands).get('p1'), 110);
});

test('checkout rejects changed packaging multipliers rather than silently recalculating basket lines', () => {
  const changedProduct = { ...product, unitsPerStrip: 12 };
  assert.throws(() => buildCheckoutLineDemands({
    items: [stripItem], liveProducts: new Map([['p1', changedProduct]]), settings, tenantId: 't1', branchId: 'br1'
  }), /packaging changed/);
});

test('checkout rejects changed configured tier prices while preserving a manual override snapshot', () => {
  const changedProduct = {
    ...product,
    sellingTiers: { ...product.sellingTiers, strip: { enabled: true, price: 2600 } }
  };
  const manualOverride = { ...stripItem, actualUnitPrice: 2400, unitPrice: 2400, priceSource: 'manual-override' as const };
  assert.throws(() => buildCheckoutLineDemands({
    items: [manualOverride], liveProducts: new Map([['p1', changedProduct]]), settings, tenantId: 't1', branchId: 'br1'
  }), /configured price changed/);
});

test('FEFO allocates across batches once and partitions exact allocations back to each line', () => {
  const items: SaleItem[] = [stripItem, { ...stripItem, tierCode: 'unit', tierLabel: 'Unit', tierMultiplier: 1, configuredPrice: 300, actualUnitPrice: 300, unitPrice: 300, quantity: 2, commercialQuantity: 2, baseQuantity: 2, total: 600, subtotal: 600, lineTotal: 600 }];
  const demands = buildCheckoutLineDemands({ items, liveProducts: new Map([['p1', product]]), settings, tenantId: 't1', branchId: 'br1' });
  const allocations = allocateFefoCheckoutLines({
    demands,
    productNames: new Map([['p1', product.name]]),
    batchesByProduct: new Map([['p1', [
      { id: 'b1', tenantId: 't1', branchId: 'br1', productId: 'p1', batchNumber: 'A', expiryDate: '2027-01-01', quantity: 6, costPerBaseUnit: 100 },
      { id: 'b2', tenantId: 't1', branchId: 'br1', productId: 'p1', batchNumber: 'B', expiryDate: '2027-06-01', quantity: 20, costPerBaseUnit: 120 }
    ]]])
  });

  assert.deepEqual(allocations[0].allocations.map(a => [a.batchId, a.baseQuantity]), [['b1', 6], ['b2', 4]]);
  assert.deepEqual(allocations[1].allocations.map(a => [a.batchId, a.baseQuantity]), [['b2', 2]]);
  assert.equal(allocations[0].actualLineCost, 1080);
  assert.equal(allocations[1].actualLineCost, 240);
  assert.equal(getCheckoutBatchDeductions(allocations).get('p1')?.get('b2'), 6);

  const finalized = finalizeCheckoutSaleItems(items, allocations);
  assert.equal(finalized[0].batchNumber, 'FEFO-MULTI');
  assert.equal(finalized[0].batchAllocations?.length, 2);
  assert.equal(finalized[1].batchNumber, 'B');
  assert.equal(finalized[1].batchAllocations?.length, 1);
  assert.notDeepEqual(finalized[0].batchAllocations, finalized[1].batchAllocations);
});

test('below-cost protection is enforced per commercial line after discount', () => {
  const demands = buildCheckoutLineDemands({
    items: [stripItem], liveProducts: new Map([['p1', product]]), settings, tenantId: 't1', branchId: 'br1'
  });
  const allocations = allocateFefoCheckoutLines({
    demands,
    batchesByProduct: new Map([['p1', [
      { id: 'b1', tenantId: 't1', branchId: 'br1', productId: 'p1', batchNumber: 'A', expiryDate: '2027-01-01', quantity: 20, costPerBaseUnit: 220 }
    ]]])
  });
  assert.doesNotThrow(() => assertCheckoutLineCostFloors({ items: [stripItem], allocations, discountPercentage: 10 }));
  assert.throws(() => assertCheckoutLineCostFloors({ items: [stripItem], allocations, discountPercentage: 20 }), /below the actual allocated batch cost/);
});

test('legacy checkout behaviour remains product-multiplier based when no tier snapshot exists', () => {
  const legacyItem: SaleItem = {
    productId: 'p1', batchId: 'b1', name: 'Panadol 500 mg', quantity: 2, unitPrice: 2500, total: 5000,
    subtotal: 5000, costPrice: 1000, batchNumber: 'A', isService: false
  };
  const demands = buildCheckoutLineDemands({
    items: [legacyItem], liveProducts: new Map([['p1', product]]), settings: { features: { multiTierSellingEnabled: false } }, tenantId: 't1', branchId: 'br1'
  });
  assert.equal(demands[0].baseQuantity, 20);
  assert.equal(demands[0].tierMultiplier, 10);
});
