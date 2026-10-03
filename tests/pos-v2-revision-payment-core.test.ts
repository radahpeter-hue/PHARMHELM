import test from 'node:test';
import assert from 'node:assert/strict';

const core = await import('../scripts/pos-v2-revision-payment-core.mjs');

const sale = {
  id: 'sale_1',
  tenantId: 'tenant_1',
  branchId: 'branch_1',
  receiptNumber: 'R-1001',
  engineVersion: 2,
  status: 'completed',
  totalAmount: 15000,
  canonicalPaymentId: 'pay_1'
};

const payment = {
  paymentId: 'pay_1',
  saleId: 'sale_1',
  tenantId: 'tenant_1',
  branchId: 'branch_1',
  receiptNumber: 'R-1001',
  engineVersion: 2,
  currency: 'UGX',
  paymentMethod: 'staff_welfare',
  amount: 15000,
  settledAmount: 5000,
  outstandingAmount: 10000,
  components: [
    { method: 'staff_welfare', amount: 10000, settledAmount: 0, outstandingAmount: 10000, status: 'unpaid' },
    { method: 'cash', amount: 5000, settledAmount: 5000, outstandingAmount: 0, status: 'settled' }
  ]
};

test('payment reversal ID is deterministic and revision scoped', () => {
  const first = core.paymentReversalId({ paymentId: 'pay_1', revisionId: 'revision_1' });
  const replay = core.paymentReversalId({ paymentId: 'pay_1', revisionId: 'revision_1' });
  const second = core.paymentReversalId({ paymentId: 'pay_1', revisionId: 'revision_2' });
  assert.equal(first, replay);
  assert.notEqual(first, second);
});

test('payment compensation preserves original immutable values and expresses explicit negative deltas', () => {
  const reversal = core.buildPaymentReversal({
    payment,
    sale,
    revisionId: 'revision_1',
    requestedBy: 'manager_1',
    requestedByName: 'Branch Manager',
    reason: 'Corrected payment allocation'
  });

  assert.equal(reversal.originalPaymentId, 'pay_1');
  assert.equal(reversal.originalSaleId, 'sale_1');
  assert.equal(reversal.originalAmount, 15000);
  assert.equal(reversal.amountDelta, -15000);
  assert.equal(reversal.settledDelta, -5000);
  assert.equal(reversal.outstandingDelta, -10000);
  assert.deepEqual(reversal.components.map((row: any) => [row.method, row.amountDelta, row.settledDelta, row.outstandingDelta]), [
    ['staff_welfare', -10000, 0, -10000],
    ['cash', -5000, -5000, 0]
  ]);
  assert.equal(payment.amount, 15000);
  assert.equal(payment.components[0].amount, 10000);
});

test('payment reversal fails closed on linkage or reconciliation drift', () => {
  assert.throws(() => core.validatePaymentForRevision({
    payment: { ...payment, branchId: 'branch_2' }, sale, revisionId: 'revision_1'
  }), /branch linkage mismatch/);

  assert.throws(() => core.validatePaymentForRevision({
    payment: { ...payment, settledAmount: 4000 }, sale, revisionId: 'revision_1'
  }), /do not reconcile/);

  assert.throws(() => core.validatePaymentForRevision({
    payment: { ...payment, components: [{ ...payment.components[0], amount: 9000 }] }, sale, revisionId: 'revision_1'
  }), /components do not reconcile/);
});

test('payment reversal requires a durable actor and reason', () => {
  assert.throws(() => core.buildPaymentReversal({
    payment, sale, revisionId: 'revision_1', requestedBy: '', requestedByName: '', reason: 'Corrected payment allocation'
  }), /actor is incomplete/);
  assert.throws(() => core.buildPaymentReversal({
    payment, sale, revisionId: 'revision_1', requestedBy: 'manager_1', requestedByName: 'Manager', reason: 'short'
  }), /8 to 500/);
});

test('payment reversal replay accepts exact identity and rejects conflicting history', () => {
  const expected = core.buildPaymentReversal({
    payment,
    sale,
    revisionId: 'revision_1',
    requestedBy: 'manager_1',
    requestedByName: 'Branch Manager',
    reason: 'Corrected payment allocation'
  });
  assert.equal(core.assertExistingPaymentReversalMatches({ existing: { ...expected }, expected }), true);
  assert.throws(() => core.assertExistingPaymentReversalMatches({
    existing: { ...expected, originalSaleId: 'sale_other' }, expected
  }), /identity conflict/);
  assert.throws(() => core.assertExistingPaymentReversalMatches({
    existing: { ...expected, amountDelta: -100 }, expected
  }), /amount conflict/);
});