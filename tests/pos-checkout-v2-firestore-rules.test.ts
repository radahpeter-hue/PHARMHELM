import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rules = readFileSync('firestore.rules', 'utf8');

test('POS authority excludes a primary Cashier at the Firestore boundary', () => {
  assert.match(rules, /function isPrimaryCashier\(\)/);
  assert.match(rules, /function isPOSOperator\(\)[\s\S]{0,180}!isPrimaryCashier\(\)/);
});

test('sale creation requires an authorised active-branch POS operator boundary', () => {
  assert.match(rules, /match \/sales\/\{saleId\}[\s\S]{0,500}allow create:[\s\S]*isPOSOperator\(\)[\s\S]*isAssignedToBranch\(request\.resource\.data\.branchId\)[\s\S]*status == 'completed'/);
});

test('V2 batch deduction is branch-scoped and cannot create negative stock', () => {
  assert.match(rules, /match \/product_batches\/\{batchId\}[\s\S]{0,3000}isPOSOperator\(\)[\s\S]*isAssignedToBranch\(resource\.data\.branchId\)/);
  assert.match(rules, /affectedKeys\(\)\.hasOnly\(\['quantity', 'lastUpdated'\]\)/);
  assert.match(rules, /request\.resource\.data\.quantity >= 0/);
});

test('V2 product compatibility mirrors may move together without opening arbitrary product edits', () => {
  assert.match(rules, /affectedKeys\(\)\.hasOnly\(\['stock', 'quantityInStock', 'stockAggregateSource', 'updatedAt'\]\)/);
  assert.match(rules, /resource\.data\.stock == resource\.data\.quantityInStock/);
  assert.match(rules, /request\.resource\.data\.stock == request\.resource\.data\.quantityInStock/);
  assert.match(rules, /request\.resource\.data\.stockAggregateSource == 'product_batches'/);
});

test('checkout attempts have an explicit immutable rule linked to the V2 sale in the same transaction', () => {
  assert.match(rules, /match \/pos_checkout_attempts\/\{attemptDocumentId\}/);
  assert.match(rules, /allow update, delete: if false/);
  assert.match(rules, /getAfter\(\/databases\/\$\(database\)\/documents\/sales\/\$\(request\.resource\.data\.saleId\)\)\.data\.engineVersion == 2/);
  assert.match(rules, /checkoutAttemptId == request\.resource\.data\.attemptId/);
  assert.match(rules, /checkoutIntentFingerprint == request\.resource\.data\.fingerprint/);
});

test('generic tenant fallback cannot bypass the dedicated checkout-attempt rule', () => {
  const generic = rules.slice(rules.indexOf('match /{collectionName}/{docId}'));
  assert.ok(generic.includes("collectionName != 'pos_checkout_attempts'"));
  const occurrences = generic.match(/collectionName != 'pos_checkout_attempts'/g) || [];
  assert.equal(occurrences.length, 5, 'get, list, create, update and delete must all exclude POS V2 attempts');
});
