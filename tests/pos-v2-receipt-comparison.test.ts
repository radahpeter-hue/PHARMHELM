import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptItemsMatch } from '../src/services/pos-v2/posSaleRevisionV2ReceiptComparison';
const item = { productId: 'cetirizine', quantity: 20, unitPrice: 100,
  batchAllocations: [{ batchId: 'batch-a', baseQuantity: 20 }] };

test('unchanged receipt maps match despite different field ordering including allocations', () => {
  const reordered = { batchAllocations: [{ baseQuantity: 20, batchId: 'batch-a' }], unitPrice: 100, quantity: 20, productId: 'cetirizine' };
  assert.equal(receiptItemsMatch([item], [reordered]), true);
});

test('real quantity price allocation and item-order changes remain conflicts', () => {
  for (const changed of [{ ...item, quantity: 10 }, { ...item, unitPrice: 200 },
    { ...item, batchAllocations: [{ batchId: 'batch-b', baseQuantity: 20 }] },
    { ...item, batchAllocations: [{ batchId: 'batch-a', baseQuantity: 10 }] }]) {
    assert.equal(receiptItemsMatch([item], [changed]), false);
  }
  assert.equal(receiptItemsMatch([item, { productId: 'other' }], [{ productId: 'other' }, item]), false);
});


test('date-valued receipt details retain their JSON value instead of becoming empty maps', () => {
  assert.equal(receiptItemsMatch([{ expiryDate: new Date('2028-01-01') }], [{ expiryDate: new Date('2028-02-01') }]), false);
  assert.equal(receiptItemsMatch([{ expiryDate: new Date('2028-01-01') }], [{ expiryDate: '2028-01-01T00:00:00.000Z' }]), true);
});
