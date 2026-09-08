import test from 'node:test';
import assert from 'node:assert/strict';
import { canOperatePos, formatPosCheckoutError } from '../src/utils/posAuthorization';

test('functional sales permission authorizes checkout regardless of job-title label', () => {
  assert.equal(canOperatePos({ role: 'Cashier' }, true), true);
  assert.equal(canOperatePos({ role: 'Dispenser' }, true), true);
  assert.equal(canOperatePos({ role: 'Custom Front Counter Role' }, true), true);
  assert.equal(canOperatePos({ role: 'Trainee', secondaryRoles: ['Custom POS Operator'] }, true), true);
});

test('view-only sales access cannot process a sale even for familiar role names', () => {
  assert.equal(canOperatePos({ role: 'Cashier' }, false), false);
  assert.equal(canOperatePos({ role: 'Dispenser' }, false), false);
  assert.equal(canOperatePos({ role: 'Custom Sales Viewer' }, false), false);
});

test('an authenticated staff profile is required for checkout', () => {
  assert.equal(canOperatePos(null, true), false);
  assert.equal(canOperatePos(undefined, true), false);
});

test('permission errors are converted to an actionable transaction message', () => {
  const wrapped = new Error(JSON.stringify({
    error: 'Missing or insufficient permissions.',
    operationType: 'write',
    path: 'sales/product_batches/products'
  }));

  const message = formatPosCheckoutError(wrapped);
  assert.match(message, /transaction permission check/i);
  assert.match(message, /No stock was deducted/i);
  assert.doesNotMatch(message, /operationType|product_batches/);
});

test('unexpected checkout errors do not expose raw technical details', () => {
  const message = formatPosCheckoutError(new Error('internal implementation detail'));
  assert.match(message, /No stock was deducted/);
  assert.doesNotMatch(message, /implementation detail/);
});
