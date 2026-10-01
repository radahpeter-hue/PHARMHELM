import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync('scripts/process-pos-v2-revisions.mjs', 'utf8');

test('revision worker wires lifecycle closeout after quotation reversal', () => {
  assert.match(worker, /pos-v2-revision-lifecycle-executor/);
  assert.match(worker, /closeoutRevisionReversal/);
  assert.match(worker, /processLifecycleCloseout/);
  assert.ok(worker.indexOf('const closeout = await processLifecycleCloseout(ref)') > worker.indexOf('const quotation = await processQuotationStage(ref, claimed)'));
  assert.ok(worker.indexOf('const closeout = await processLifecycleCloseout(ref)') < worker.indexOf('await releaseRequestLease(ref)'));
  assert.match(worker, /lifecycleClosed:/);
});

test('worker can recover a crash after the final reversal consumer completed but before lifecycle closeout', () => {
  assert.match(worker, /\['PENDING', 'FAILED', 'PROCESSING', 'REVERSAL_COMPLETE'\]/);
  assert.doesNotMatch(worker, /request\.status === 'COMPLETED' \|\| request\.status === 'REVERSAL_COMPLETE'/);
  assert.match(worker, /preservingReversalComplete/);
  assert.match(worker, /status: preservingReversalComplete \? 'REVERSAL_COMPLETE' : 'PROCESSING'/);
});

test('lifecycle closeout remains delegated to the isolated executor', () => {
  assert.match(worker, /closeoutRevisionReversal\(\{ db, requestRef: ref, FieldValue \}\)/);
  assert.doesNotMatch(worker, /revisionLifecycle: 'REPLACEMENT_PENDING'/);
  assert.doesNotMatch(worker, /supersededBySaleId:/);
  assert.doesNotMatch(worker, /status: 'revised'/);
});
