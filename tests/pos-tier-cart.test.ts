import test from 'node:test';
import assert from 'node:assert/strict';
import type { Product, ProductBatch } from '../src/types';
import { buildTierCartItem, getCartLineIdentity, getProductUsableBaseStock, mergeTierCartItem, replaceTierCartQuantity } from '../src/services/posTierCartService';
import { resolveRequestedSellingTier } from '../src/services/sellingTierService';

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

const batches: ProductBatch[] = [
  {
    id: 'b1', tenantId: 't1', productId: 'p1', branchId: 'br1', quantity: 12,
    expiryDate: '2027-01-01', batchNumber: 'A', purchasePrice: 100, sellingPrice: 300, batch_status: 'active'
  },
  {
    id: 'b2', tenantId: 't1', productId: 'p1', branchId: 'br1', quantity: 88,
    expiryDate: '2027-06-01', batchNumber: 'B', purchasePrice: 120, sellingPrice: 300, batch_status: 'active'
  }
];

test('strip and pack remain separate commercial cart lines', () => {
  const strip = buildTierCartItem({ product, tier: resolveRequestedSellingTier(product, settings, 'strip'), batches, tenantId: 't1', branchId: 'br1' });
  const pack = buildTierCartItem({ product, tier: resolveRequestedSellingTier(product, settings, 'pack'), batches, tenantId: 't1', branchId: 'br1' });
  const cart = mergeTierCartItem(mergeTierCartItem([], strip), pack);
  assert.equal(cart.length, 2);
  assert.notEqual(getCartLineIdentity(cart[0]), getCartLineIdentity(cart[1]));
});

test('same tier with same commercial terms merges and preserves base quantity', () => {
  const strip = buildTierCartItem({ product, tier: resolveRequestedSellingTier(product, settings, 'strip'), batches, tenantId: 't1', branchId: 'br1' });
  const cart = mergeTierCartItem(mergeTierCartItem([], strip), strip);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].commercialQuantity, 2);
  assert.equal(cart[0].baseQuantity, 20);
  assert.equal(cart[0].lineTotal, 5000);
});

test('usable stock is counted in base units across active unexpired batches', () => {
  assert.equal(getProductUsableBaseStock(batches, 'p1', new Date('2026-09-08')), 100);
});

test('quantity replacement checks total base-unit demand across tiers', () => {
  const unit = buildTierCartItem({ product, tier: resolveRequestedSellingTier(product, settings, 'unit'), batches, tenantId: 't1', branchId: 'br1', commercialQuantity: 5 });
  const strip = buildTierCartItem({ product, tier: resolveRequestedSellingTier(product, settings, 'strip'), batches, tenantId: 't1', branchId: 'br1' });
  const cart = mergeTierCartItem(mergeTierCartItem([], unit), strip);
  const stripIdentity = getCartLineIdentity(cart.find(item => item.tierCode === 'strip')!);
  const updated = replaceTierCartQuantity({ cart, targetIdentity: stripIdentity, product, batches, commercialQuantity: 9 });
  const updatedStrip = updated.find(item => item.tierCode === 'strip')!;
  assert.equal(updatedStrip.baseQuantity, 90);
  assert.throws(() => replaceTierCartQuantity({ cart: updated, targetIdentity: stripIdentity, product, batches, commercialQuantity: 10 }), /Insufficient stock/);
});
