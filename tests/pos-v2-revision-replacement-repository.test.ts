import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const repository = readFileSync('src/services/pos-v2/posCheckoutV2Repository.ts', 'utf8');

test('replacement checkout reuses the canonical POS V2 identity helpers', () => {
  assert.match(repository, /from '\.\/posCheckoutV2Identity'/);
  assert.match(repository, /checkoutV2AttemptDocumentId/);
  assert.match(repository, /checkoutV2SaleDocumentId/);
  assert.doesNotMatch(repository, /function deterministicDocumentId/);
});

test('replacement revision linkage is part of the immutable checkout fingerprint', () => {
  assert.match(repository, /revisionReplacement: request\.revisionReplacement \?/);
  assert.match(repository, /revisionRequestId: request\.revisionReplacement\.revisionRequestId/);
  assert.match(repository, /originalSaleId: request\.revisionReplacement\.originalSaleId/);
  assert.match(repository, /replacementOutboxEventId: request\.revisionReplacement\.replacementOutboxEventId/);
});

test('replacement checkout validates canonical identity before entering the transaction', () => {
  assert.match(repository, /validatePosCheckoutV2RevisionReplacementContract\(\{/);
  assert.match(repository, /preparedSaleId: prepared\.saleId/);
  assert.match(repository, /preparedPaymentId: prepared\.paymentId/);
  assert.match(repository, /preparedOutboxEventId: prepared\.outboxEventId/);
});

test('replacement checkout revalidates the immutable original lifecycle inside the checkout transaction', () => {
  const transactionStart = repository.indexOf('return runTransaction(db');
  const originalRead = repository.indexOf("doc(db, 'sales', replacement.originalSaleId)");
  const lifecycleGuard = repository.indexOf('validatePosCheckoutV2ReplacementOriginalLifecycle');
  const firstInventoryWrite = repository.indexOf("transaction.update(doc(db, 'product_batches'");

  assert.ok(transactionStart >= 0);
  assert.ok(originalRead > transactionStart);
  assert.ok(lifecycleGuard >= 0);
  assert.ok(firstInventoryWrite > originalRead);
  assert.match(repository, /revisionLifecycle[^\n]*REPLACEMENT_PENDING|validatePosCheckoutV2ReplacementOriginalLifecycle/);
});

test('canonical replacement sale/payment/outbox/attempt all carry durable revision linkage', () => {
  assert.match(repository, /isRevisionReplacement: true/);
  assert.match(repository, /revisionId: replacement\.revisionId/);
  assert.match(repository, /revisionRequestId: replacement\.revisionRequestId/);
  assert.match(repository, /revisionSequence: replacement\.sequence/);
  assert.match(repository, /revisionOfSaleId: replacement\.originalSaleId/);
  assert.match(repository, /originalReceiptNumber: replacement\.originalReceiptNumber/);

  const linkageSpreadCount = (repository.match(/\.\.\.revisionLinkage/g) || []).length;
  assert.ok(linkageSpreadCount >= 4, 'sale, payment, outbox and attempt should all persist revision linkage');
});

test('protected checkout integration does not silently mutate or supersede the original sale', () => {
  assert.doesNotMatch(repository, /transaction\.update\(originalSaleRef/);
  assert.doesNotMatch(repository, /supersededBySaleId:\s*prepared\.saleId/);
  assert.doesNotMatch(repository, /status:\s*'revised'/);
});

test('idempotent replay verifies revision linkage before returning an existing replacement', () => {
  assert.match(repository, /assertReplacementReplayLinkage\(sale, replacement\)/);
  assert.match(repository, /Existing replacement checkout does not match the revision linkage/);
});
