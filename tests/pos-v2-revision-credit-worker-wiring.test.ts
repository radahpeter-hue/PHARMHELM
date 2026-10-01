import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync('scripts/process-pos-v2-revisions.mjs', 'utf8');

test('revision worker wires institutional credit compensation after welfare and before quotation work', () => {
  assert.match(worker, /pos-v2-revision-credit-executor/);
  assert.match(worker, /executeInstitutionalCreditReversal/);
  assert.match(worker, /processInstitutionalCreditStage/);
  assert.match(worker, /institutionalCreditProcessed/);
  assert.ok(worker.indexOf('processInstitutionalCreditStage(ref, claimed)') > worker.indexOf('processWelfareStage(ref, claimed)'));
  assert.doesNotMatch(worker, /processQuotationStage/);
});

test('institutional credit stage uses its own consumer lifecycle and durable completion metadata', () => {
  assert.match(worker, /markConsumerProcessing\(ref, 'institutionalCredit'\)/);
  assert.match(worker, /markInstitutionalCreditCompleted/);
  assert.match(worker, /markInstitutionalCreditFailure/);
  assert.match(worker, /institutionalCreditReversalId:/);
  assert.match(worker, /institutionalCreditReversalReplay:/);
  assert.match(worker, /institutionalCreditReceivableId:/);
  assert.match(worker, /institutionalCreditAmountDelta:/);
  assert.match(worker, /institutionalCreditOutstandingDelta:/);
  assert.match(worker, /institutionalCreditReversalCompletedAt:/);
});

test('worker keeps receivable mutation encapsulated inside the dedicated credit executor', () => {
  assert.doesNotMatch(worker, /collection\('credit_receivables'\)/);
  assert.doesNotMatch(worker, /collection\('pos_credit_reversals'\)/);
  assert.match(worker, /executeInstitutionalCreditReversal\(\{/);
});

test('worker still preserves the normal POS V2 sale outbox path by not importing the Batch 4 processor', () => {
  assert.doesNotMatch(worker, /process-pos-v2-outbox/);
  assert.match(worker, /collection\('pos_sale_revision_requests'\)/);
  assert.match(worker, /mode: 'revision-credit'/);
});
