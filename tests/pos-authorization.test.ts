import test from 'node:test';
import assert from 'node:assert/strict';
import { canOperatePos, formatPosCheckoutError } from '../src/utils/posAuthorization';

test('functional sales permission authorizes checkout regardless of job-title spelling', () => {
  assert.equal(canOperatePos({ role: 'Dispenser' }, true), true);
  assert.equal(canOperatePos({ role: 'cashier' }, true), true);
  assert.equal(canOperatePos({ role: 'Custom POS Operator' }, true), true);
  assert.equal(canOperatePos({ role: 'staff', secondaryRoles: ['Branch Manager'] }, true), true);
});

test('view-only or no-access users cannot process a sale', () => {
  assert.equal(canOperatePos({ role: 'IT Support Staff' }, false), false);
  assert.equal(canOperatePos({ role: 'Custom Sales Viewer' }, false), false);
  assert.equal(canOperatePos({ role: 'Cashier' }, false), false);
});

test('a resolved permission still requires an authenticated staff profile', () => {
  assert.equal(canOperatePos(null, true), false);
  assert.equal(canOperatePos(undefined, true), false);
});

test('permission errors describe the failed transaction instead of falsely blaming the role', () => {
  const wrapped = new Error(JSON.stringify({
    error: 'Missing or insufficient permissions.',
    operationType: 'write',
    path: 'sales/product_batches/products'
  }));

  const message = formatPosCheckoutError(wrapped);
  assert.match(message, /transaction permission check/i);
  assert.match(message, /No stock was deducted/i);
  assert.doesNotMatch(message, /operationType|product_batches|not authorised/i);
});

test('unexpected checkout errors do not expose raw technical details', () => {
  const message = formatPosCheckoutError(new Error('internal implementation detail'));
  assert.match(message, /No stock was deducted/);
  assert.doesNotMatch(message, /implementation detail/);
});
