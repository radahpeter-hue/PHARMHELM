import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rules = readFileSync('firestore.rules', 'utf8');

test('POS authority excludes a primary Cashier at the Firestore boundary', () => {
  assert.match(rules, /function isPrimaryCashier\(\)/);
  assert.match(rules, /function isPOSOperator\(\)[\s\S]{0,180}!isPrimaryCashier\(\)/);
});

test('sale creation requires an authorised active-branch POS operator boundary', () => {
  assert.match(rules, /match \/sales\/\{saleId\}[\s\S]{0,2200}allow create:[\s\S]*isPOSOperator\(\)[\s\S]*isAssignedToBranch\(request\.resource\.data\.branchId\)[\s\S]*status == 'completed'/);
});

test('V2 sale creation is linked to the canonical payment and durable outbox in the same transaction', () => {
  const saleStart = rules.indexOf('match /sales/{saleId}');
  const paymentStart = rules.indexOf('match /pos_payments/{paymentId}', saleStart);
  const saleRule = rules.slice(saleStart, paymentStart);
  assert.match(saleRule, /canonicalPaymentId/);
  assert.match(saleRule, /transactionOutboxEventId/);
  assert.match(saleRule, /getAfter\(\/databases\/\$\(database\)\/documents\/pos_payments/);
  assert.match(saleRule, /getAfter\(\/databases\/\$\(database\)\/documents\/pos_transaction_outbox/);
  assert.match(saleRule, /\.data\.amount == request\.resource\.data\.totalAmount/);
});

test('V2 batch deduction is branch-scoped and cannot create negative stock', () => {
  assert.match(rules, /match \/product_batches\/\{batchId\}[\s\S]{0,9000}isPOSOperator\(\)[\s\S]*isAssignedToBranch\(resource\.data\.branchId\)/);
  assert.match(rules, /affectedKeys\(\)\.hasOnly\(\['quantity', 'lastUpdated'\]\)/);
  assert.match(rules, /request\.resource\.data\.quantity >= 0/);
});

test('V2 product compatibility mirrors may move together without opening arbitrary product edits', () => {
  assert.match(rules, /affectedKeys\(\)\.hasOnly\(\['stock', 'quantityInStock', 'stockAggregateSource', 'updatedAt'\]\)/);
  assert.match(rules, /resource\.data\.stock == resource\.data\.quantityInStock/);
  assert.match(rules, /request\.resource\.data\.stock == request\.resource\.data\.quantityInStock/);
  assert.match(rules, /request\.resource\.data\.stockAggregateSource == 'product_batches'/);
});

test('canonical POS payments are immutable, tenant/branch scoped and linked to the V2 sale', () => {
  const start = rules.indexOf('match /pos_payments/{paymentId}');
  const end = rules.indexOf('match /pos_transaction_outbox/{eventId}', start);
  assert.ok(start >= 0 && end > start);
  const paymentRule = rules.slice(start, end);
  assert.match(paymentRule, /isPOSOperator\(\)/);
  assert.match(paymentRule, /isAssignedToBranch\(request\.resource\.data\.branchId\)/);
  assert.match(paymentRule, /request\.resource\.data\.paymentId == paymentId/);
  assert.match(paymentRule, /request\.resource\.data\.operatorUid == request\.auth\.uid/);
  assert.match(paymentRule, /settledAmount \+ request\.resource\.data\.outstandingAmount == request\.resource\.data\.amount/);
  assert.match(paymentRule, /\.data\.canonicalPaymentId == paymentId/);
  assert.match(paymentRule, /allow update, delete: if false/);
});

test('transaction outbox is immutable client-side, starts PENDING and is linked to sale/payment', () => {
  const start = rules.indexOf('match /pos_transaction_outbox/{eventId}');
  const end = rules.indexOf('match /pos_checkout_attempts/{attemptDocumentId}', start);
  assert.ok(start >= 0 && end > start);
  const outboxRule = rules.slice(start, end);
  assert.match(outboxRule, /request\.resource\.data\.eventId == eventId/);
  assert.match(outboxRule, /request\.resource\.data\.eventType == 'POS_SALE_COMMITTED'/);
  assert.match(outboxRule, /request\.resource\.data\.status == 'PENDING'/);
  assert.match(outboxRule, /request\.resource\.data\.attemptCount == 0/);
  assert.match(outboxRule, /documents\/sales/);
  assert.match(outboxRule, /documents\/pos_payments/);
  assert.match(outboxRule, /allow update, delete: if false/);
});

test('checkout attempts have an explicit immutable rule linked to sale, payment and outbox in the same transaction', () => {
  const attemptRuleStart = rules.indexOf('match /pos_checkout_attempts/{attemptDocumentId}');
  assert.ok(attemptRuleStart >= 0);
  const attemptRule = rules.slice(attemptRuleStart, rules.indexOf('match /welfare_records/', attemptRuleStart));
  assert.match(attemptRule, /allow update, delete: if false/);
  assert.match(attemptRule, /getAfter\(\/databases\/\$\(database\)\/documents\/sales\/\$\(request\.resource\.data\.saleId\)\)\.data\.engineVersion == 2/);
  assert.match(attemptRule, /checkoutAttemptId == request\.resource\.data\.attemptId/);
  assert.match(attemptRule, /checkoutIntentFingerprint == request\.resource\.data\.fingerprint/);
  assert.match(attemptRule, /request\.resource\.data\.paymentId is string/);
  assert.match(attemptRule, /request\.resource\.data\.outboxEventId is string/);
  assert.match(attemptRule, /documents\/pos_payments/);
  assert.match(attemptRule, /documents\/pos_transaction_outbox/);
});

test('generic tenant fallback cannot bypass dedicated POS V2 transaction records', () => {
  const generic = rules.slice(rules.indexOf('match /{collectionName}/{docId}'));
  for (const collectionName of ['pos_checkout_attempts', 'pos_payments', 'pos_transaction_outbox']) {
    const pattern = new RegExp(`collectionName != '${collectionName}'`, 'g');
    const occurrences = generic.match(pattern) || [];
    assert.equal(occurrences.length, 5, `get, list, create, update and delete must all exclude ${collectionName}`);
  }
});
