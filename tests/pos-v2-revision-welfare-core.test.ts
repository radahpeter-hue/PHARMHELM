import test from 'node:test';
import assert from 'node:assert/strict';

const core = await import('../scripts/pos-v2-revision-welfare-core.mjs');

const sale = {
  id: 'sale_1', tenantId: 'tenant_1', branchId: 'branch_1', receiptNumber: 'R-1001',
  engineVersion: 2, status: 'completed', patientId: 'staff_1'
};
const payment = {
  paymentId: 'pay_1', saleId: 'sale_1', tenantId: 'tenant_1', branchId: 'branch_1',
  engineVersion: 2,
  components: [
    { method: 'staff_welfare', amount: 10000 },
    { method: 'cash', amount: 5000 }
  ]
};

test('welfare compensation extracts only the staff welfare component', () => {
  assert.equal(core.welfareComponentAmount(payment), 10000);
});

test('welfare reversal IDs are deterministic and revision scoped', () => {
  const first = core.welfareReversalIds({ tenantId: 'tenant_1', saleId: 'sale_1', revisionId: 'revision_1' });
  const replay = core.welfareReversalIds({ tenantId: 'tenant_1', saleId: 'sale_1', revisionId: 'revision_1' });
  const second = core.welfareReversalIds({ tenantId: 'tenant_1', saleId: 'sale_1', revisionId: 'revision_2' });
  assert.deepEqual(first, replay);
  assert.notEqual(first.reversalId, second.reversalId);
});

test('welfare reversal contract is append-only compensation with a negative monetary delta', () => {
  const reversal = core.buildWelfareReversal({
    sale, payment, revisionId: 'revision_1', requestedBy: 'manager_1', requestedByName: 'Branch Manager',
    reason: 'Correct staff welfare payment'
  });
  assert.equal(reversal.amount, 10000);
  assert.equal(reversal.amountDelta, -10000);
  assert.equal(reversal.originalSaleId, 'sale_1');
  assert.equal(reversal.originalPaymentId, 'pay_1');
  assert.equal(reversal.source, 'POS_REVISION');
});

test('welfare original posting validation enforces tenant, sale, amount and beneficiary integrity', () => {
  const welfare = { tenantId: 'tenant_1', saleId: 'sale_1', staffId: 'staff_1', amount: 10000 };
  const expense = { tenantId: 'tenant_1', saleId: 'sale_1', amount: 10000 };
  const transfer = { tenantId: 'tenant_1', saleId: 'sale_1', amount: 10000 };
  const beneficiary = { tenantId: 'tenant_1', welfare_spent: 12000, welfare_used_ytd: 15000 };
  assert.equal(core.validateWelfareOriginals({ sale, payment, welfare, expense, transfer, beneficiary, expectedAmount: 10000 }), true);
  assert.throws(() => core.validateWelfareOriginals({
    sale, payment, welfare: { ...welfare, amount: 9000 }, expense, transfer, beneficiary, expectedAmount: 10000
  }), /amounts do not reconcile/);
  assert.throws(() => core.validateWelfareOriginals({
    sale, payment, welfare: { ...welfare, staffId: 'staff_other' }, expense, transfer, beneficiary, expectedAmount: 10000
  }), /beneficiary linkage mismatch/);
});

test('welfare compensation fails closed before beneficiary counters can become negative', () => {
  assert.throws(() => core.validateWelfareOriginals({
    sale,
    payment,
    welfare: { tenantId: 'tenant_1', saleId: 'sale_1', staffId: 'staff_1', amount: 10000 },
    expense: { tenantId: 'tenant_1', saleId: 'sale_1', amount: 10000 },
    transfer: { tenantId: 'tenant_1', saleId: 'sale_1', amount: 10000 },
    beneficiary: { tenantId: 'tenant_1', welfare_spent: 9000, welfare_used_ytd: 15000 },
    expectedAmount: 10000
  }), /negative beneficiary balance/);
});

test('welfare reversal replay accepts exact history and rejects conflicting history', () => {
  const expected = core.buildWelfareReversal({
    sale, payment, revisionId: 'revision_1', requestedBy: 'manager_1', requestedByName: 'Branch Manager',
    reason: 'Correct staff welfare payment'
  });
  assert.equal(core.assertExistingWelfareReversalMatches({ existing: { ...expected }, expected }), true);
  assert.throws(() => core.assertExistingWelfareReversalMatches({
    existing: { ...expected, originalSaleId: 'sale_other' }, expected
  }), /identity conflict/);
});