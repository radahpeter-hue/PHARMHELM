import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('scripts/pos-v2-revision-lifecycle-executor.mjs', 'utf8');

test('lifecycle closeout advances only fully reversed requests to replacement pending', () => {
  assert.match(source, /requestStatus !== REVERSAL_COMPLETE/);
  assert.match(source, /allReversalConsumersComplete/);
  assert.match(source, /status: REPLACEMENT_PENDING/);
  assert.match(source, /reversalState: REVERSAL_COMPLETE/);
  assert.match(source, /replacementLifecycle: REPLACEMENT_PENDING/);
});

test('lifecycle closeout preserves the original sale canonical completed status', () => {
  assert.match(source, /sale\.status !== 'completed'/);
  assert.doesNotMatch(source, /status:\s*'revised'/);
  assert.doesNotMatch(source, /status:\s*'voided'/);
  assert.doesNotMatch(source, /tx\.delete/);
  assert.match(source, /revisionLifecycle: REPLACEMENT_PENDING/);
});

test('lifecycle closeout validates matching revision and replacement identities', () => {
  assert.match(source, /sale\.revisionLocked !== true/);
  assert.match(source, /clean\(sale\.revisionId\) !== revisionId/);
  assert.match(source, /clean\(sale\.pendingReplacementSaleId\) !== replacementSaleId/);
  assert.match(source, /clean\(sale\.supersededBySaleId\)/);
});

test('lifecycle closeout is replay safe once replacement is already pending', () => {
  assert.match(source, /requestStatus === REPLACEMENT_PENDING/);
  assert.match(source, /replayed: true/);
  assert.match(source, /replayed: false/);
});

test('lifecycle closeout requires every reversal consumer to be completed or not applicable', () => {
  for (const consumer of ['inventory', 'consumption', 'payment', 'welfare', 'institutionalCredit', 'quotation']) {
    assert.match(source, new RegExp(`'${consumer}'`));
  }
  assert.match(source, /status === 'COMPLETED' \|\| status === 'NOT_APPLICABLE'/);
});
