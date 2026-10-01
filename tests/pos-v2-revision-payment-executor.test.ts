import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('scripts/pos-v2-revision-payment-executor.mjs', 'utf8');

test('payment executor writes an append-only compensating record and never mutates canonical pos_payments', () => {
  assert.match(source, /collection\('pos_payment_reversals'\)/);
  assert.match(source, /tx\.create\(ref,/);
  assert.doesNotMatch(source, /collection\('pos_payments'\)/);
  assert.doesNotMatch(source, /tx\.update\([^\n]*pos_payments/);
  assert.doesNotMatch(source, /tx\.delete/);
});

test('payment executor is deterministic and idempotent on exact replay', () => {
  assert.match(source, /buildPaymentReversal/);
  assert.match(source, /assertExistingPaymentReversalMatches/);
  assert.match(source, /if \(existingSnap\.exists\)/);
  assert.match(source, /replayed: true/);
  assert.match(source, /replayed: false/);
});

test('payment executor persists durable completion metadata with server timestamps', () => {
  assert.match(source, /status: 'COMPLETED'/);
  assert.match(source, /createdAt: timestamp/);
  assert.match(source, /completedAt: timestamp/);
  assert.match(source, /FieldValue\.serverTimestamp\(\)/);
});

test('payment executor preserves explicit monetary deltas for later finance compensation and analytics', () => {
  assert.match(source, /amountDelta: expected\.amountDelta/);
  assert.match(source, /settledDelta: expected\.settledDelta/);
  assert.match(source, /outstandingDelta: expected\.outstandingDelta/);
  assert.match(source, /originalPaymentId: expected\.originalPaymentId/);
});

test('isolated payment executor is not wired until its own contract is certified', () => {
  const worker = readFileSync('scripts/process-pos-v2-revisions.mjs', 'utf8');
  assert.doesNotMatch(worker, /pos-v2-revision-payment-executor/);
  assert.doesNotMatch(worker, /executePaymentReversal/);
});