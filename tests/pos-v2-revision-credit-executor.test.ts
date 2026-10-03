import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync('scripts/pos-v2-revision-credit-core.mjs', 'utf8');
const executor = readFileSync('scripts/pos-v2-revision-credit-executor.mjs', 'utf8');

test('institutional credit compensation is deterministic and revision scoped', () => {
  assert.match(core, /institutionalCreditReversalId/);
  assert.match(core, /pos_credit_reversal_/);
  assert.match(core, /revisionId/);
  assert.match(core, /originalReceivableId: sale\.id/);
  assert.match(core, /source: 'POS_REVISION'/);
});

test('institutional credit compensation preserves original amount and expresses negative deltas', () => {
  assert.match(core, /amountDelta: -amount/);
  assert.match(core, /outstandingDelta: -amount/);
  assert.match(executor, /priorOutstandingAmount/);
  assert.match(executor, /reversedAmount: expected\.amount/);
});

test('institutional credit reversal fails closed if any receivable settlement already occurred', () => {
  assert.match(core, /outstanding - amount/);
  assert.match(core, /partially or fully settled\. Manual review is required/);
  assert.match(core, /receivable amount does not reconcile with canonical payment/);
});

test('institutional credit executor never deletes the receivable and leaves a permanent reversed record', () => {
  assert.match(executor, /collection\('credit_receivables'\)/);
  assert.match(executor, /collection\('pos_credit_reversals'\)/);
  assert.match(executor, /tx\.create\(reversalRef,/);
  assert.match(executor, /tx\.update\(receivableRef,/);
  assert.match(executor, /status: 'reversed'/);
  assert.match(executor, /outstanding_ugx: 0/);
  assert.doesNotMatch(executor, /tx\.delete/);
});

test('institutional credit executor is idempotent and fails closed on partial reversal history', () => {
  assert.match(executor, /if \(reversalSnap\.exists\)/);
  assert.match(executor, /assertExistingInstitutionalCreditReversalMatches/);
  assert.match(executor, /replayed: true/);
  assert.match(executor, /replayed: false/);
  assert.match(executor, /partial or conflicting\. Manual review required/);
  assert.match(executor, /without the canonical reversal record\. Manual review required/);
});

test('institutional credit reversal validates canonical POS V2 sale and payment linkage', () => {
  assert.match(core, /Number\(sale\.engineVersion \|\| 0\) !== 2/);
  assert.match(core, /sale\.status !== 'completed'/);
  assert.match(core, /payment\.saleId !== sale\.id/);
  assert.match(core, /receivable\.tenantId !== sale\.tenantId/);
  assert.match(core, /receivable\.paymentId/);
});
