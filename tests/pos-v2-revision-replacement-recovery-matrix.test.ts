import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const orchestrator = readFileSync('src/services/pos-v2/posSaleRevisionV2ReplacementOrchestrator.ts', 'utf8');
const repository = readFileSync('src/services/pos-v2/posCheckoutV2Repository.ts', 'utf8');
const worker = readFileSync('scripts/process-pos-v2-revision-replacements.mjs', 'utf8');
const finalizer = readFileSync('scripts/pos-v2-revision-replacement-finalizer.mjs', 'utf8');

test('replacement checkout retries are pinned to one deterministic attempt and canonical identity set', () => {
  assert.match(orchestrator, /attemptId: identifiers\.replacementAttemptId/);
  assert.match(orchestrator, /replacementSaleId: identifiers\.replacementSaleId/);
  assert.match(orchestrator, /replacementPaymentId: identifiers\.replacementPaymentId/);
  assert.match(orchestrator, /replacementOutboxEventId: identifiers\.replacementOutboxEventId/);
  assert.match(repository, /assertReplacementReplayLinkage\(sale, replacement\)/);
  assert.match(repository, /Existing replacement checkout does not match the revision linkage/);
});

test('a crash before replacement checkout leaves the linkage worker harmlessly waiting', () => {
  const stateRead = worker.indexOf("if (clean(request.status) !== 'REPLACEMENT_PENDING')");
  const saleRead = worker.indexOf("db.collection('sales').doc(replacementSaleId).get()");
  const awaiting = worker.indexOf('AWAITING_REPLACEMENT_CHECKOUT');
  const finalizeCall = worker.lastIndexOf('finalizeRevisionReplacementLinkage({ db, requestRef: ref, FieldValue })');

  assert.ok(stateRead >= 0);
  assert.ok(saleRead > stateRead);
  assert.ok(awaiting > saleRead);
  assert.ok(finalizeCall > awaiting);
});

test('a crash after replacement checkout but before linkage resumes from the existing canonical sale', () => {
  assert.match(worker, /const readiness = await replacementExists\(ref\)/);
  assert.match(worker, /if \(!replacementSnap\.exists\) return \{ ready: false, reason: 'AWAITING_REPLACEMENT_CHECKOUT' \}/);
  assert.match(worker, /return \{ ready: true, replacementSaleId \}/);
  assert.match(finalizer, /const \[originalSnap, replacementSnap, paymentSnap, outboxSnap\] = await Promise\.all\(\[/);
  assert.match(finalizer, /assertReplacementChain\(\{ request, originalSale, replacementSale, payment, outbox \}\)/);
});

test('duplicate or stale linkage workers cannot silently double-finalize or cross-link a replacement', () => {
  assert.match(worker, /const requestSnap = await ref\.get\(\)/);
  assert.match(worker, /STATE_CHANGED/);
  assert.match(finalizer, /db\.runTransaction/);
  assert.match(finalizer, /Completed original POS V2 sale supersession does not match the canonical replacement/);
  assert.match(finalizer, /Replacement POS V2 sale revision linkage mismatch/);
  assert.match(finalizer, /Replacement POS V2 sale crossed the original tenant or branch boundary/);
});

test('recovery never creates a second sale or mutates canonical replacement payment/outbox', () => {
  assert.doesNotMatch(worker, /\.collection\('sales'\)\.add\(/);
  assert.doesNotMatch(worker, /\.collection\('sales'\)\.doc\([^)]*\)\.set\(/);
  assert.doesNotMatch(finalizer, /tx\.update\(replacementRef/);
  assert.doesNotMatch(finalizer, /tx\.update\(paymentRef/);
  assert.doesNotMatch(finalizer, /tx\.update\(outboxRef/);
  assert.doesNotMatch(finalizer, /\.delete\(|tx\.delete\(/);
});
