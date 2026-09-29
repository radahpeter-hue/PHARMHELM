import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProductBatch } from '../src/types';
import { capRequestedCommercialQuantity, getProductEligibleBatches, getProductUsableBaseStock } from '../src/services/posTierCartService';

const batch = (overrides: Partial<ProductBatch> = {}): ProductBatch => ({
  id: 'b1', tenantId: 't1', branchId: 'br1', productId: 'p1', batchNumber: 'B1',
  expiryDate: '2027-12-31', quantity: 10, purchasePrice: 100, sellingPrice: 200,
  batch_status: 'active', ...overrides
} as ProductBatch);

test('POS eligibility excludes expired, invalid-date, quarantined and invalid-cost batches', () => {
  const rows = [
    batch({ id: 'ok', quantity: 17, expiryDate: '2027-03-31' }),
    batch({ id: 'expired', quantity: 90, expiryDate: '2025-01-01' }),
    batch({ id: 'invalid-date', quantity: 30, expiryDate: 'not-a-date' }),
    batch({ id: 'quarantine', quantity: 80, batch_status: 'quarantined' }),
    batch({ id: 'bad-cost', quantity: 50, purchasePrice: Number.NaN })
  ];
  assert.equal(getProductUsableBaseStock(rows, 'p1', new Date('2026-09-29T07:00:00Z')), 17);
  assert.deepEqual(getProductEligibleBatches(rows, 'p1', new Date('2026-09-29T07:00:00Z')).map(row => row.id), ['ok']);
});

test('requested quantity is capped to eligible stock rather than overfilling basket', () => {
  assert.equal(capRequestedCommercialQuantity({ requestedCommercialQuantity: 45, tierMultiplier: 1, usableBaseStock: 40 }), 40);
  assert.equal(capRequestedCommercialQuantity({ requestedCommercialQuantity: 5, tierMultiplier: 10, usableBaseStock: 45 }), 4);
  assert.equal(capRequestedCommercialQuantity({ requestedCommercialQuantity: 10, tierMultiplier: 1, usableBaseStock: 40, otherReservedBaseStock: 35 }), 5);
});

test('V2 uses batch totals as canonical aggregate and Compliance writes quarantine into batch authority', () => {
  const repository = readFileSync('src/services/pos-v2/posCheckoutV2Repository.ts', 'utf8');
  const expiry = readFileSync('src/modules/qa/ExpiryLogs.tsx', 'utf8');
  const recalls = readFileSync('src/modules/qa/Recalls.tsx', 'utf8');
  const rules = readFileSync('firestore.rules', 'utf8');
  assert.match(repository, /authoritativeBatchTotals/);
  assert.doesNotMatch(repository, /assertAggregateMatches\(/);
  assert.match(expiry, /quarantineInventoryBatch/);
  assert.match(recalls, /quarantineRecallBatches/);
  assert.match(rules, /request\.resource\.data\.batch_status == 'quarantined'/);
});
