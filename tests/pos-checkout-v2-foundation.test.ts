import test from 'node:test';
import assert from 'node:assert/strict';
import type { Product, SaleItem } from '../src/types';
import type { CheckoutBatchCandidate } from '../src/services/posCheckoutTierService';
import { calculateCheckoutV2, isV2SellableBatch } from '../src/services/pos-v2/posCheckoutV2Calculator';
import { PosCheckoutV2Error } from '../src/services/pos-v2/posCheckoutV2Errors';
import { resolvePosCheckoutV2Mode } from '../src/services/pos-v2/posCheckoutV2FeatureService';

const product: Product = {
  id: 'p1', tenantId: 't1', productId: 'PRD-1', sku: 'SKU-1', name: 'Panadol 500 mg',
  category: 'drug/medicine', costPricePerPack: 12000, sellingPricePerUnit: 300, taxExempt: true, taxRate: 0,
  unitsPerPack: 100, unitsPerStrip: 10, unit: 'tablet', baseUnit: 'tablet', dosageForm: 'Tablet', unitOfSell: 'strip',
  sellingTiers: {
    unit: { enabled: true, price: 300 },
    strip: { enabled: true, price: 2500 },
    pack: { enabled: true, price: 22000 }
  },
  defaultSellingTierCode: 'strip'
};

const stripItem: SaleItem = {
  productId: 'p1', batchId: '', name: product.name, productName: product.name,
  quantity: 1, commercialQuantity: 1, baseQuantity: 10, tierCode: 'strip', tierLabel: 'Strip', tierMultiplier: 10,
  configuredPrice: 2500, actualUnitPrice: 2500, priceSource: 'configured-tier', unitPrice: 2500,
  total: 2500, subtotal: 2500, lineTotal: 2500, costPrice: 1000, batchNumber: 'FEFO-PENDING', isService: false,
  tenantId: 't1', branchId: 'br1'
};

const settings = { features: { multiTierSellingEnabled: true } };
const now = new Date('2026-09-14T10:00:00+03:00');

const batch = (overrides: Partial<CheckoutBatchCandidate> = {}): CheckoutBatchCandidate => ({
  id: 'b1', tenantId: 't1', branchId: 'br1', productId: 'p1', batchNumber: 'A',
  expiryDate: '2027-01-01', batchStatus: 'active', quantity: 20, costPerBaseUnit: 100,
  ...overrides
});

test('feature resolver defaults enabled tenants to shadow and allows branch override', () => {
  assert.equal(resolvePosCheckoutV2Mode({ tenant: {} }).effectiveMode, 'legacy');
  assert.equal(resolvePosCheckoutV2Mode({ tenant: { features: { posCheckoutV2Enabled: true } } }).effectiveMode, 'shadow');
  assert.equal(resolvePosCheckoutV2Mode({
    tenant: { features: { posCheckoutV2Enabled: true }, posCheckoutEngine: 'shadow' },
    branch: { posCheckoutEngine: 'v2' }
  }).effectiveMode, 'v2');
});

test('V2 sellable batch boundary excludes cross-tenant, cross-branch, quarantined and expired stock', () => {
  const common = { tenantId: 't1', branchId: 'br1', productId: 'p1', now };
  assert.equal(isV2SellableBatch({ ...common, batch: batch() }), true);
  assert.equal(isV2SellableBatch({ ...common, batch: batch({ tenantId: 't2' }) }), false);
  assert.equal(isV2SellableBatch({ ...common, batch: batch({ branchId: 'br2' }) }), false);
  assert.equal(isV2SellableBatch({ ...common, batch: batch({ batchStatus: 'quarantined' }) }), false);
  assert.equal(isV2SellableBatch({ ...common, batch: batch({ expiryDate: '2026-09-13' }) }), false);
});

test('V2 calculation reuses tier validation and FEFO while producing immutable allocation snapshots', () => {
  const result = calculateCheckoutV2({
    tenantId: 't1', branchId: 'br1', items: [stripItem], liveProducts: new Map([['p1', product]]), settings, now,
    batchesByProduct: new Map([['p1', [
      batch({ id: 'b1', batchNumber: 'A', expiryDate: '2026-12-01', quantity: 6, costPerBaseUnit: 100 }),
      batch({ id: 'b2', batchNumber: 'B', expiryDate: '2027-06-01', quantity: 20, costPerBaseUnit: 120 })
    ]]])
  });

  assert.equal(result.demands[0].baseQuantity, 10);
  assert.deepEqual(result.allocations[0].allocations.map(a => [a.batchId, a.baseQuantity]), [['b1', 6], ['b2', 4]]);
  assert.equal(result.finalizedItems[0].batchNumber, 'FEFO-MULTI');
  assert.equal(result.finalizedItems[0].baseQuantity, 10);
  assert.equal(result.actualCostTotal, 1080);
  assert.equal(result.productDeductions.get('p1'), 10);
  assert.equal(result.batchDeductions.get('p1')?.get('b2'), 4);
});

test('V2 rejects a product whose available stock exists only in another branch', () => {
  assert.throws(() => calculateCheckoutV2({
    tenantId: 't1', branchId: 'br1', items: [stripItem], liveProducts: new Map([['p1', product]]), settings, now,
    batchesByProduct: new Map([['p1', [batch({ branchId: 'br2' })]]])
  }), (error: unknown) => error instanceof PosCheckoutV2Error && error.code === 'NO_SELLABLE_BATCH');
});

test('V2 maps packaging changes to a typed error without mutating live checkout', () => {
  assert.throws(() => calculateCheckoutV2({
    tenantId: 't1', branchId: 'br1', items: [stripItem], liveProducts: new Map([['p1', { ...product, unitsPerStrip: 12 }]]), settings, now,
    batchesByProduct: new Map([['p1', [batch()]])
  }), (error: unknown) => error instanceof PosCheckoutV2Error && error.code === 'PACKAGING_CHANGED');
});
