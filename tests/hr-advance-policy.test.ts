import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAdvanceRequest, sumApprovedUnpaidAdvanceRequests } from '../src/services/hrAdvancePolicy';

test('advance requests require whole positive UGX and bounded whole repayment months', () => {
  assert.equal(validateAdvanceRequest(50_000, 2), null);
  for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.notEqual(validateAdvanceRequest(value, 2), null);
  }
  for (const months of [0, -3, 1.5, 121, NaN]) {
    assert.notEqual(validateAdvanceRequest(50_000, months), null);
  }
});

test('approved requests are not represented as disbursements', () => {
  assert.equal(sumApprovedUnpaidAdvanceRequests([
    { status: 'Pending', amount_requested: 9_000 },
    { status: 'Approved', amount_requested: 10_000 },
    { status: 'Disbursed', amount_requested: 20_000 },
    { status: 'Rejected', amount_requested: 30_000 }
  ]), 10_000);
});

test('invalid or overflowing approved totals fail closed', () => {
  assert.throws(() => sumApprovedUnpaidAdvanceRequests([{ status: 'Approved', amount_requested: 1.5 }]));
  assert.throws(() => sumApprovedUnpaidAdvanceRequests([
    { status: 'Approved', amount_requested: Number.MAX_SAFE_INTEGER },
    { status: 'Approved', amount_requested: 1 }
  ]));
});
