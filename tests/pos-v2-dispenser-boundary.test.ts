import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rules = readFileSync('firestore.rules', 'utf8');
const rbac = readFileSync('src/config/rbac.ts', 'utf8');

test('Dispenser remains a functional POS role in system RBAC', () => {
  assert.match(
    rbac,
    /name:\s*'Dispenser'[\s\S]{0,500}permissions:\s*makePermissions\(\{[\s\S]{0,220}sales:\s*operate\(\)[\s\S]{0,220}inventory:\s*view\(\)/
  );
});

test('Dispenser is recognized by the Firestore POS boundary', () => {
  const start = rules.indexOf('function isPOSOperator()');
  const end = rules.indexOf('function isMarketing()', start);
  assert.ok(start >= 0 && end > start);
  const posOperator = rules.slice(start, end);
  assert.match(posOperator, /'Dispenser'/);
  assert.match(posOperator, /'dispenser'/);
});

test('Dispenser is not promoted to a general Inventory operator', () => {
  const start = rules.indexOf('function isInventoryOperator()');
  const end = rules.indexOf('function isStockOperator()', start);
  assert.ok(start >= 0 && end > start);
  const inventoryOperator = rules.slice(start, end);
  assert.doesNotMatch(inventoryOperator, /'Dispenser'/);
  assert.doesNotMatch(inventoryOperator, /'dispenser'/);
});

test('POS batch deduction keeps branch scope and narrow field mutation', () => {
  const start = rules.indexOf('match /product_batches/{batchId}');
  const end = rules.indexOf('match /opening_stock_sessions/{sessionId}', start);
  assert.ok(start >= 0 && end > start);
  const block = rules.slice(start, end);
  assert.match(block, /isPOSOperator\(\)/);
  assert.match(block, /isAssignedToBranch\(resource\.data\.branchId\)/);
  assert.match(block, /affectedKeys\(\)\.hasOnly\(\['quantity', 'lastUpdated'\]\)/);
});

test('POS product aggregate healing remains narrow', () => {
  const start = rules.indexOf('match /products/{productId}');
  const end = rules.indexOf('match /product_batches/{batchId}', start);
  assert.ok(start >= 0 && end > start);
  const block = rules.slice(start, end);
  assert.match(block, /isPOSOperator\(\)/);
  assert.match(block, /affectedKeys\(\)\.hasOnly\(\['stock', 'quantityInStock', 'stockAggregateSource', 'updatedAt'\]\)/);
  assert.match(block, /stockAggregateSource == 'product_batches'/);
});
