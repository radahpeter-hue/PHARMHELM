import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const executor = await import('../scripts/pos-v2-revision-inventory-executor.mjs');
const source = readFileSync('scripts/pos-v2-revision-inventory-executor.mjs', 'utf8');

test('inventory reversal event is explicit, compensating and revision scoped', () => {
  const timestamp = { marker: 'server-time' };
  const event = executor.buildInventoryReversalEvent({
    sale: {
      id: 'sale_1',
      tenantId: 'tenant_1',
      branchId: 'branch_1',
      receiptNumber: 'R-1001'
    },
    restore: {
      productId: 'p1',
      eventId: 'sales_sale_1_p1_revision_revision_1',
      baseQuantity: 20
    },
    originalEvent: {
      eventId: 'sales_sale_1_p1_p1',
      isExceptional: false,
      exceptionalReason: null,
      dateKey: '2026-10-01'
    },
    revisionId: 'revision_1',
    workerId: 'revision-worker-1',
    serverTimestamp: timestamp
  });

  assert.equal(event.eventType, 'SALE_REVERSAL');
  assert.equal(event.quantityDeltaBaseUnits, 20);
  assert.equal(event.consumptionDeltaBaseUnits, -20);
  assert.equal(event.reversalOfEventId, 'sales_sale_1_p1_p1');
  assert.equal(event.revisionId, 'revision_1');
  assert.equal(event.sourceDocumentId, 'sale_1');
  assert.equal(event.eventId, 'sales_sale_1_p1_revision_revision_1');
  assert.equal(event.effectiveAt, timestamp);
  assert.equal(event.createdAt, timestamp);
});

test('inventory executor uses one transaction for batch restore, product mirror, summary and reversal event', () => {
  assert.match(source, /return db\.runTransaction\(async tx =>/);
  assert.match(source, /collection\('product_batches'\)/);
  assert.match(source, /collection\('products'\)/);
  assert.match(source, /collection\('branchConsumptionDaily'\)/);
  assert.match(source, /collection\('inventoryMovementEvents'\)/);
  assert.match(source, /reverseConsumptionSummary/);
  assert.match(source, /tx\.create\(db\.collection\('inventoryMovementEvents'\)/);
});

test('inventory executor is idempotent and fails closed on partial or conflicting reversal history', () => {
  assert.match(source, /existingCount === reversalEventSnaps\.length/);
  assert.match(source, /replayed: true/);
  assert.match(source, /Partial inventory reversal detected\. Manual review required\./);
  assert.match(source, /Inventory reversal event identity conflict\. Manual review required\./);
});

test('inventory executor validates original consumption and exact live historical identities before writes', () => {
  assert.match(source, /Original consumption event/);
  assert.match(source, /Original consumption quantity does not reconcile/);
  assert.match(source, /assertLiveBatchMatchesRestore/);
  assert.match(source, /assertLiveProductCanRestore/);
  const firstWrite = source.indexOf('tx.update(ref, {\n        quantity:');
  const batchValidation = source.indexOf('assertLiveBatchMatchesRestore');
  const productValidation = source.indexOf('assertLiveProductCanRestore');
  assert.ok(firstWrite > batchValidation);
  assert.ok(firstWrite > productValidation);
});

test('isolated executor is not yet wired into the live revision worker', () => {
  const worker = readFileSync('scripts/process-pos-v2-revisions.mjs', 'utf8');
  assert.doesNotMatch(worker, /pos-v2-revision-inventory-executor/);
  assert.doesNotMatch(worker, /executeInventoryAndConsumptionReversal/);
});