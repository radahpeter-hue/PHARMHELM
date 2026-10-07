import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rules = readFileSync('firestore.rules', 'utf8');

test('POS authority excludes a primary Cashier at the Firestore boundary', () => {
  assert.match(rules, /function isPOSOperator\(\)[\s\S]{0,180}getUserData\(\)\.role != 'cashier'/);
  assert.match(rules, /function isPOSOperator\(\)[\s\S]{0,240}getUserData\(\)\.role != 'Cashier'/);
});

test('collection-specific helpers stay local instead of inflating every match scope', () => {
  const firstMatch = rules.indexOf('match /vehicles/{vehicleId}');
  const globalHelpers = rules.slice(0, firstMatch);
  for (const helper of [
    'hasValidBranchShape',
    'isAssignedBranchManager',
    'isSupervisorPracticalAssessmentUpdate',
    'isSupervisorTraineeAssessmentUpdate'
  ]) {
    assert.doesNotMatch(globalHelpers, new RegExp(`function ${helper}\\(`));
    assert.match(rules.slice(firstMatch), new RegExp(`function ${helper}\\(`));
  }
});

test('global role and custom-module checks share compact primitives', () => {
  const firstMatch = rules.indexOf('match /vehicles/{vehicleId}');
  const globalHelpers = rules.slice(0, firstMatch);
  assert.match(globalHelpers, /function hasAnyRole\(roleNames\)/);
  assert.match(globalHelpers, /function hasRole\(roleName\)\s*\{\s*return hasAnyRole\(\[roleName\]\);/);
  assert.match(globalHelpers, /function hasCustomModuleAccess\(moduleKey, accessLevels\)/);
  assert.match(globalHelpers, /function hasCustomModuleFunctional\(moduleKey\)\s*\{\s*return hasCustomModuleAccess\(moduleKey, \['view_functional', 'all'\]\);/);
  assert.match(globalHelpers, /function hasCustomModuleView\(moduleKey\)\s*\{\s*return hasCustomModuleAccess\(moduleKey, \['view_only', 'view_functional', 'all'\]\);/);
  assert.equal((globalHelpers.match(/documents\/role_realms_of_operation/g) || []).length, 6);
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
  assert.match(saleRule, /payment\.amount == sale\.totalAmount/);
  assert.match(saleRule, /isLegacySale\(request\.resource\.data\) \|\|[\s\S]{0,100}hasValidV2SaleLinks\(saleId\)/);
});

test('V2 batch deduction is branch-scoped and cannot create negative stock', () => {
  assert.match(rules, /match \/product_batches\/\{batchId\}[\s\S]{0,9000}isPOSOperator\(\)[\s\S]*isAssignedToBranch\(resource\.data\.branchId\)/);
  assert.match(rules, /affectedKeys\(\)\.hasOnly\(\['quantity', 'lastUpdated'\]\)/);
  assert.match(rules, /request\.resource\.data\.quantity >= 0/);
});

test('V2 product compatibility mirrors may heal from batch authority without opening arbitrary product edits', () => {
  const productStart = rules.indexOf('match /products/{productId}');
  const batchStart = rules.indexOf('match /product_batches/{batchId}', productStart);
  assert.ok(productStart >= 0 && batchStart > productStart);
  const productRule = rules.slice(productStart, batchStart);
  assert.match(productRule, /affectedKeys\(\)\.hasOnly\(\['stock', 'quantityInStock', 'stockAggregateSource', 'updatedAt'\]\)/);
  assert.doesNotMatch(productRule, /resource\.data\.stock == resource\.data\.quantityInStock/);
  assert.match(productRule, /request\.resource\.data\.stock is number/);
  assert.match(productRule, /request\.resource\.data\.quantityInStock is number/);
  assert.match(productRule, /request\.resource\.data\.stock >= 0/);
  assert.match(productRule, /request\.resource\.data\.quantityInStock >= 0/);
  assert.match(productRule, /request\.resource\.data\.stock == request\.resource\.data\.quantityInStock/);
  assert.match(productRule, /request\.resource\.data\.stockAggregateSource == 'product_batches'/);
});

test('canonical POS payments are immutable, tenant/branch scoped and linked to the V2 sale', () => {
  const start = rules.indexOf('match /pos_payments/{paymentId}');
  const end = rules.indexOf('match /pos_transaction_outbox/{eventId}', start);
  assert.ok(start >= 0 && end > start);
  const paymentRule = rules.slice(start, end);
  assert.match(paymentRule, /isPOSOperator\(\)/);
  assert.match(paymentRule, /isAssignedToBranch\(request\.resource\.data\.branchId\)/);
  assert.match(paymentRule, /payment\.paymentId == paymentId/);
  assert.match(paymentRule, /payment\.operatorUid == request\.auth\.uid/);
  assert.match(paymentRule, /payment\.settledAmount \+ payment\.outstandingAmount == payment\.amount/);
  assert.match(paymentRule, /sale\.canonicalPaymentId == paymentId/);
  assert.match(paymentRule, /hasValidPaymentIdentity\(paymentId\)/);
  assert.match(paymentRule, /hasValidPaymentSettlement\(\)/);
  assert.match(paymentRule, /paymentMatchesSale\(paymentId\)/);
  assert.match(paymentRule, /allow update, delete: if false/);
});

test('transaction outbox starts PENDING, permits only atomic supersession, and remains linked to sale/payment', () => {
  const start = rules.indexOf('match /pos_transaction_outbox/{eventId}');
  const end = rules.indexOf('match /pos_checkout_attempts/{attemptDocumentId}', start);
  assert.ok(start >= 0 && end > start);
  const outboxRule = rules.slice(start, end);
  assert.match(outboxRule, /outbox\.eventId == eventId/);
  assert.match(outboxRule, /outbox\.eventType == 'POS_SALE_COMMITTED'/);
  assert.match(outboxRule, /outbox\.status == 'PENDING'/);
  assert.match(outboxRule, /outbox\.attemptCount == 0/);
  assert.match(outboxRule, /documents\/sales/);
  assert.match(outboxRule, /documents\/pos_payments/);
  assert.match(outboxRule, /hasValidOutboxEnvelope\(eventId\)/);
  assert.match(outboxRule, /outboxMatchesSale\(eventId\)/);
  assert.match(outboxRule, /outboxMatchesPayment\(\)/);
  assert.match(outboxRule, /allow update: if atomicOutboxSupersession\(eventId\)/);
  assert.match(outboxRule, /allow delete: if false/);
});

test('checkout attempts have an explicit immutable rule linked to sale, payment and outbox in the same transaction', () => {
  const attemptRuleStart = rules.indexOf('match /pos_checkout_attempts/{attemptDocumentId}');
  assert.ok(attemptRuleStart >= 0);
  const attemptRule = rules.slice(attemptRuleStart, rules.indexOf('match /welfare_records/', attemptRuleStart));
  assert.match(attemptRule, /allow update, delete: if false/);
  assert.match(attemptRule, /let sale = getAfter\(\/databases\/\$\(database\)\/documents\/sales\/\$\(attempt\.saleId\)\)\.data/);
  assert.match(attemptRule, /sale\.engineVersion == 2/);
  assert.match(attemptRule, /sale\.checkoutAttemptId == attempt\.attemptId/);
  assert.match(attemptRule, /sale\.checkoutIntentFingerprint == attempt\.fingerprint/);
  assert.match(attemptRule, /attempt\.paymentId is string/);
  assert.match(attemptRule, /attempt\.outboxEventId is string/);
  assert.match(attemptRule, /documents\/pos_payments/);
  assert.match(attemptRule, /documents\/pos_transaction_outbox/);
  assert.match(attemptRule, /attemptMatchesSale\(\)/);
  assert.match(attemptRule, /attemptMatchesPayment\(\)/);
  assert.match(attemptRule, /attemptMatchesOutbox\(\)/);
});

test('POS create allow expressions remain shallow enough for the hosted rules compiler', () => {
  const starts = [
    'match /sales/{saleId}',
    'match /pos_payments/{paymentId}',
    'match /pos_transaction_outbox/{eventId}',
    'match /pos_checkout_attempts/{attemptDocumentId}'
  ];

  for (const [index, marker] of starts.entries()) {
    const start = rules.indexOf(marker);
    const end = index + 1 < starts.length
      ? rules.indexOf(starts[index + 1], start)
      : rules.indexOf('match /welfare_records/', start);
    const block = rules.slice(start, end);
    const allowCreate = block.match(/allow create:[\s\S]*?;/)?.[0] || '';
    assert.ok(allowCreate.length > 0, `${marker} must keep an explicit create rule`);
    assert.ok(allowCreate.length < 700, `${marker} create condition must stay compiler-safe`);
    assert.ok((allowCreate.match(/&&/g) || []).length <= 8, `${marker} create condition is becoming monolithic again`);
  }
});

test('generic tenant fallback cannot bypass dedicated POS V2 transaction records', () => {
  const generic = rules.slice(rules.indexOf('match /{collectionName}/{docId}'));
  for (const collectionName of ['pos_checkout_attempts', 'pos_payments', 'pos_transaction_outbox']) {
    for (const operation of ['get', 'list', 'create', 'update', 'delete']) {
      const guard = generic.split('\n').find(line => line.includes(`allow ${operation}:`)) || '';
      assert.match(guard, /!\(collectionName in \[/);
      assert.ok(guard.includes(`'${collectionName}'`), `${operation} must exclude ${collectionName}`);
    }
  }
});

test('QA quarantine rule preserves branch scope and narrow quarantine-only fields', () => {
  const start = rules.indexOf('match /product_batches/{batchId}');
  const end = rules.indexOf('match /opening_stock_sessions/{sessionId}', start);
  assert.ok(start >= 0 && end > start);
  const batchRules = rules.slice(start, end);
  assert.match(batchRules, /isQA\(\)/);
  assert.match(batchRules, /hasAnyRole\(\['QA Head', 'QA Manager', 'admin', 'Admin'\]\)/);
  assert.match(batchRules, /isAssignedToBranch\(resource\.data\.branchId\)/);
  assert.match(batchRules, /affectedKeys\(\)\.hasOnly\(\['batch_status', 'lastUpdated'\]\)/);
  assert.match(batchRules, /request\.resource\.data\.batch_status == 'quarantined'/);
});
