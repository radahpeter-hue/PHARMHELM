import test from 'node:test';
import assert from 'node:assert/strict';
import { canOperatePos, formatPosCheckoutError } from '../src/utils/posAuthorization';

test('any authenticated profile with sales operate permission can process a sale', () => {
  assert.equal(canOperatePos({ role: 'Cashier' }, true), true);
  assert.equal(canOperatePos({ role: 'Dispenser' }, true), true);
  assert.equal(canOperatePos({ role: 'Custom Sales Operator' }, true), true);
  assert.equal(canOperatePos({ role: 'Staff', secondaryRoles: ['Custom POS Role'] }, true), true);
});

test('view-only access cannot process a sale regardless of role name', () => {
  assert.equal(canOperatePos({ role: 'Cashier' }, false), false);
  assert.equal(canOperatePos({ role: 'Pharmacist' }, false), false);
  assert.equal(canOperatePos({ role: 'CEO' }, false), false);
});

test('an unauthenticated or unresolved profile cannot process a sale', () => {
  assert.equal(canOperatePos(null, true), false);
  assert.equal(canOperatePos(undefined, true), false);
});

test('permission errors are classified without falsely blaming the role', () => {
  const wrapped = new Error(JSON.stringify({
    error: 'Missing or insufficient permissions.',
    operationType: 'write',
    path: 'sales/product_batches/products'
  }));

  const message = formatPosCheckoutError(wrapped);
  assert.match(message, /transaction permission check/i);
  assert.match(message, /No stock was deducted/i);
  assert.doesNotMatch(message, /not authorised/i);
  assert.doesNotMatch(message, /operationType|product_batches/i);
});

test('unexpected checkout errors do not expose raw technical details', () => {
  const message = formatPosCheckoutError(new Error('internal implementation detail'));
  assert.match(message, /No stock was deducted/);
  assert.doesNotMatch(message, /implementation detail/);
});
