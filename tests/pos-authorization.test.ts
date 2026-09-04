import test from 'node:test';
import assert from 'node:assert/strict';
import { canOperatePos, formatPosCheckoutError, hasTrustedPosOperatorRole } from '../src/utils/posAuthorization';

test('supported POS roles are matched without case sensitivity', () => {
  assert.equal(hasTrustedPosOperatorRole({ role: 'Cashier' }), true);
  assert.equal(hasTrustedPosOperatorRole({ role: 'IT HEAD' }), true);
  assert.equal(hasTrustedPosOperatorRole({ role: 'staff', secondaryRoles: ['Branch Manager'] }), true);
});

test('view-only and unsupported custom roles cannot process a sale', () => {
  assert.equal(canOperatePos({ role: 'IT Support Staff' }, false), false);
  assert.equal(canOperatePos({ role: 'Custom Sales Viewer' }, true), false);
});

test('both operate permission and a trusted role are required', () => {
  assert.equal(canOperatePos({ role: 'Cashier' }, false), false);
  assert.equal(canOperatePos({ role: 'Cashier' }, true), true);
});

test('permission errors are converted to an actionable, non-technical message', () => {
  const wrapped = new Error(JSON.stringify({
    error: 'Missing or insufficient permissions.',
    operationType: 'write',
    path: 'sales/product_batches/products'
  }));

  const message = formatPosCheckoutError(wrapped);
  assert.match(message, /not authorised/);
  assert.doesNotMatch(message, /operationType|product_batches/);
});

test('unexpected checkout errors do not expose raw technical details', () => {
  const message = formatPosCheckoutError(new Error('internal implementation detail'));
  assert.match(message, /No stock was deducted/);
  assert.doesNotMatch(message, /implementation detail/);
});
