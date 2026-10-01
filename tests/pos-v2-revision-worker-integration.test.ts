import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const revisionWorker = readFileSync('scripts/process-pos-v2-revisions.mjs', 'utf8');
const existingSaleWorker = readFileSync('scripts/process-pos-v2-outbox.mjs', 'utf8');

test('revision intake stays isolated from the existing POS sale outbox worker', () => {
  assert.match(existingSaleWorker, /event\.eventType !== 'POS_SALE_COMMITTED'/);
  assert.match(existingSaleWorker, /where\('eventType', '==', 'POS_SALE_COMMITTED'\)/);
  assert.doesNotMatch(existingSaleWorker, /pos_sale_revision_requests/);
  assert.doesNotMatch(existingSaleWorker, /POS_SALE_REVISION_REQUESTED/);

  assert.match(revisionWorker, /collection\('pos_sale_revision_requests'\)/);
  assert.match(revisionWorker, /REVISION_REQUEST_TYPE/);
  assert.match(revisionWorker, /validateRevisionRequest/);
});

test('revision intake locks lifecycle metadata without changing the canonical sale status', () => {
  assert.match(revisionWorker, /revisionLocked: true/);
  assert.match(revisionWorker, /revisionLifecycle: 'REVERSAL_PENDING'/);
  assert.match(revisionWorker, /pendingReplacementSaleId:/);
  assert.match(revisionWorker, /revisionId: request\.revisionId/);
  assert.doesNotMatch(revisionWorker, /status:\s*'revised'/);
  assert.doesNotMatch(revisionWorker, /tx\.update\(saleRef,[\s\S]{0,900}status:/);
});

test('revision intake validates canonical sale payment and outbox before locking or resuming', () => {
  assert.match(revisionWorker, /sale\.canonicalPaymentId/);
  assert.match(revisionWorker, /sale\.transactionOutboxEventId/);
  assert.match(revisionWorker, /collection\('pos_payments'\)/);
  assert.match(revisionWorker, /collection\('pos_transaction_outbox'\)/);
  assert.match(revisionWorker, /validateRevisionRequest\(\{ request: validationRequest, sale, payment, outbox, resume: resumingOwnLock \}\)/);
  assert.match(revisionWorker, /clean\(sale\.revisionId\) === clean\(request\.revisionId\)/);
  assert.match(revisionWorker, /revisionLifecycle\) === 'REVERSAL_PENDING'/);
  assert.match(revisionWorker, /if \(!resumingOwnLock\) \{/);
});

test('Stage 5B intake does not yet mutate inventory or downstream finance records', () => {
  for (const collection of [
    'product_batches',
    'products',
    'inventoryMovementEvents',
    'branchConsumptionDaily',
    'welfare',
    'branch_expenses',
    'cashTransfers',
    'credit_receivables',
    'pos_quotations'
  ]) {
    assert.doesNotMatch(revisionWorker, new RegExp(`collection\\('${collection}'\\)`));
  }
});

test('revision intake is lease and retry bounded', () => {
  assert.match(revisionWorker, /MAX_ATTEMPTS/);
  assert.match(revisionWorker, /requiresManualReview/);
  assert.match(revisionWorker, /leaseOwner: WORKER_ID/);
  assert.match(revisionWorker, /leaseExpiresAt/);
  assert.match(revisionWorker, /status: 'FAILED'/);
});