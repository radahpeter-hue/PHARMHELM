import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync('scripts/process-pos-v2-revisions.mjs', 'utf8');

test('revision worker wires quotation compensation as the final downstream reversal stage', () => {
  assert.match(worker, /pos-v2-revision-quotation-executor/);
  assert.match(worker, /executeQuotationReversal/);
  assert.match(worker, /processQuotationStage/);
  assert.match(worker, /quotationProcessed/);
  assert.ok(worker.indexOf('processQuotationStage(ref, claimed)') > worker.indexOf('processInstitutionalCreditStage(ref, claimed)'));
});

test('quotation stage owns an independent consumer lifecycle and durable completion metadata', () => {
  assert.match(worker, /markConsumerProcessing\(ref, 'quotation'\)/);
  assert.match(worker, /markQuotationCompleted/);
  assert.match(worker, /markQuotationFailure/);
  assert.match(worker, /quotationReversalId:/);
  assert.match(worker, /quotationReversalReplay:/);
  assert.match(worker, /quotationRestoredStatus:/);
  assert.match(worker, /quotationReversalCompletedAt:/);
});

test('worker delegates quotation mutation to the dedicated executor and does not mutate quotation collections directly', () => {
  assert.doesNotMatch(worker, /collection\('pos_quotations'\)/);
  assert.doesNotMatch(worker, /collection\('pos_quotation_reversals'\)/);
  assert.match(worker, /executeQuotationReversal\(\{/);
});

test('quotation is included before the request lease is released so reversal completion cannot be reported prematurely', () => {
  assert.ok(worker.indexOf('const quotation = await processQuotationStage(ref, claimed)') < worker.indexOf('await releaseRequestLease(ref)'));
  assert.match(worker, /status: reversalState === 'REVERSAL_COMPLETE' \? 'REVERSAL_COMPLETE' : 'PROCESSING'/);
});