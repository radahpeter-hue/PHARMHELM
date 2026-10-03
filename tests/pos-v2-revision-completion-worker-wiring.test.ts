import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync('scripts/process-pos-v2-revision-completions.mjs', 'utf8');

test('completion worker watches only replacement-created revision requests', () => {
  assert.match(worker, /pos_sale_revision_requests/);
  assert.match(worker, /where\('status', '==', 'REPLACEMENT_CREATED'\)/);
  assert.doesNotMatch(worker, /where\('status', '==', 'REPLACEMENT_PENDING'\)/);
  assert.doesNotMatch(worker, /where\('status', '==', 'REVERSAL_COMPLETE'\)/);
});

test('completion worker waits for the canonical replacement outbox to be fully processed', () => {
  assert.match(worker, /replacementOutboxEventId/);
  assert.match(worker, /pos_transaction_outbox/);
  assert.match(worker, /AWAITING_REPLACEMENT_OUTBOX/);
  assert.match(worker, /AWAITING_DOWNSTREAM_POSTING/);
  assert.match(worker, /clean\(outbox\.status\) !== 'PROCESSED'/);
});

test('completion worker delegates durable completion to the isolated executor', () => {
  assert.match(worker, /completeRevisionLifecycle/);
  const readinessIndex = worker.indexOf('const readiness = await completionReadiness(ref)');
  const completionIndex = worker.indexOf('const result = await completeRevisionLifecycle({ db, requestRef: ref, FieldValue })');
  assert.ok(readinessIndex >= 0 && completionIndex > readinessIndex);
});

test('completion worker does not mutate sales payments or outbox directly', () => {
  assert.doesNotMatch(worker, /\.update\(/);
  assert.doesNotMatch(worker, /\.set\(/);
  assert.doesNotMatch(worker, /\.delete\(/);
  assert.doesNotMatch(worker, /runTransaction/);
});

test('completion worker cannot create another replacement transaction', () => {
  assert.doesNotMatch(worker, /executeCheckoutV2/);
  assert.doesNotMatch(worker, /buildPosV2ReplacementCheckoutRequest/);
  assert.doesNotMatch(worker, /collection\('sales'\)\.doc\([^)]*\)\.set/);
});

test('completion worker uses the named production firestore database contract', () => {
  assert.match(worker, /ai-studio-f7d8654b-e089-425a-a506-38159afe1e75/);
  assert.match(worker, /getFirestore\(app, DATABASE_ID\)/);
});
