import test from 'node:test';
import assert from 'node:assert/strict';
import { canOperatePos, formatPosCheckoutError } from '../src/utils/posAuthorization';

test('functional sales permission authorizes checkout for non-cashier operators', () => {
  assert.equal(canOperatePos({ role: 'Dispenser' }, true), true);
  assert.equal(canOperatePos({ role: 'Pharmacist' }, true), true);
  assert.equal(canOperatePos({ role: 'Branch Manager' }, true), true);
  assert.equal(canOperatePos({ role: 'Custom POS Operator' }, true), true);
  assert.equal(canOperatePos({ role: 'staff', secondaryRoles: ['Branch Manager'] }, true), true);
});

test('cashier role is explicitly excluded from completing sales even if sales operate is present', () => {
  assert.equal(canOperatePos({ role: 'cashier' }, true), false);
  assert.equal(canOperatePos({ role: 'Cashier' }, true), false);
  assert.equal(canOperatePos({ role: 'CASHIER', secondaryRoles: ['Branch Manager'] }, true), false);
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

test('permission errors describe the failed atomic checkout without falsely blaming the operator role', () => {
  const wrapped = new Error(JSON.stringify({
    error: 'Missing or insufficient permissions.',
    operationType: 'write',
    path: 'sales/product_batches/products'
  }));

  const message = formatPosCheckoutError(wrapped);
  assert.match(message, /Atomic checkout reached Firestore/i);
  assert.match(message, /No stock was deducted/i);
  assert.match(message, /app-side POS permission check already passed/i);
  assert.doesNotMatch(message, /operationType|not authorised/i);
});

test('unexpected checkout errors preserve the underlying diagnostic message', () => {
  const message = formatPosCheckoutError(new Error('internal implementation detail'));
  assert.equal(message, 'internal implementation detail');
});
