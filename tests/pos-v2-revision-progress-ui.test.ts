import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getPosV2RevisionProgressCopy } from '../src/components/sales/PosV2ReceiptRevisionProgress';

const source = readFileSync('src/components/sales/PosV2ReceiptRevisionProgress.tsx', 'utf8');

test('revision progress labels every durable lifecycle stage clearly', () => {
  assert.equal(getPosV2RevisionProgressCopy('PENDING').title, 'Revision queued');
  assert.equal(getPosV2RevisionProgressCopy('PROCESSING').title, 'Reversing original transaction');
  assert.equal(getPosV2RevisionProgressCopy('REVERSAL_COMPLETE').title, 'Original reversal complete');
  assert.equal(getPosV2RevisionProgressCopy('REPLACEMENT_PENDING').title, 'Creating corrected receipt');
  assert.equal(getPosV2RevisionProgressCopy('REPLACEMENT_CREATED').title, 'Corrected receipt created');
  assert.equal(getPosV2RevisionProgressCopy('COMPLETED').complete, true);
  assert.equal(getPosV2RevisionProgressCopy('FAILED').failed, true);
});

test('progress UI surfaces durable worker errors and manual review without starting a second revision', () => {
  assert.match(source, /lastError/);
  assert.match(source, /requiresManualReview/);
  assert.match(source, /Do not create a second revision request/);
});

test('replacement retry is exposed only while the durable request remains replacement pending', () => {
  assert.match(source, /status === 'REPLACEMENT_PENDING'/);
  assert.match(source, /onRetryReplacement/);
  assert.match(source, /Retry corrected checkout/);
});

test('completed progress displays the corrected receipt reference', () => {
  assert.match(source, /replacementReceiptNumber/);
  assert.match(source, /Corrected receipt/);
});
