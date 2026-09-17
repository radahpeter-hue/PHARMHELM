import test from 'node:test';
import assert from 'node:assert/strict';

const core = await import('../scripts/pos-v2-batch4-core.mjs');

const sale = {
  id: 'sale_1',
  tenantId: 'tenant_1',
  branchId: 'branch_1',
  receiptNumber: 'R-1001',
  engineVersion: 2,
  totalAmount: 15000,
  sourceQuotationId: 'quote_1',
  items: [
    { productId: 'p1', quantity: 2, commercialQuantity: 2, tierCode: 'strip', tierMultiplier: 10, baseQuantity: 20 },
    { productId: 'service', quantity: 1, isService: true }
  ]
};

const payment = {
  paymentId: 'pay_1',
  saleId: 'sale_1',
  tenantId: 'tenant_1',
  branchId: 'branch_1',
  receiptNumber: 'R-1001',
  engineVersion: 2,
  amount: 15000,
  components: [
    { method: 'staff_welfare', amount: 5000 },
    { method: 'institutional_credit', amount: 10000 }
  ]
};

test('Batch 4 derives all applicable consumers from canonical sale/payment', () => {
  assert.deepEqual(core.consumerApplicability({ sale, payment }), {
    consumption: true,
    welfare: true,
    institutionalCredit: true,
    quotation: true
  });
});

test('Batch 4 leaves non-applicable consumers terminal without inventing work', () => {
  const consumers = core.initializeConsumers({
    sale: { ...sale, sourceQuotationId: undefined, items: [{ productId: 'svc', isService: true }] },
    payment: { ...payment, components: [{ method: 'cash', amount: 15000 }] },
    nowIso: '2026-09-17T00:00:00.000Z'
  });
  for (const name of core.BATCH4_CONSUMERS) {
    assert.equal(consumers[name].status, 'NOT_APPLICABLE');
  }
  assert.equal(core.deriveGlobalStatus(consumers), 'PROCESSED');
});

test('Batch 4 preserves completed consumer state across retries', () => {
  const existing = {
    consumption: {
      status: 'COMPLETED',
      attemptCount: 1,
      lastError: null,
      completedAt: '2026-09-17T01:00:00.000Z'
    }
  };
  const consumers = core.initializeConsumers({ sale, payment, existingConsumers: existing, nowIso: '2026-09-17T02:00:00.000Z' });
  assert.equal(consumers.consumption.status, 'COMPLETED');
  assert.equal(consumers.consumption.attemptCount, 1);
  assert.equal(consumers.welfare.status, 'PENDING');
});

test('global event status is derived independently from consumer outcomes', () => {
  const base = Object.fromEntries(core.BATCH4_CONSUMERS.map(name => [name, { status: 'NOT_APPLICABLE' }]));
  base.consumption = { status: 'COMPLETED' };
  base.welfare = { status: 'FAILED' };
  assert.equal(core.deriveGlobalStatus(base), 'FAILED');
  base.welfare = { status: 'PROCESSING' };
  assert.equal(core.deriveGlobalStatus(base), 'PROCESSING');
  base.welfare = { status: 'COMPLETED' };
  assert.equal(core.deriveGlobalStatus(base), 'PROCESSED');
});

test('deterministic welfare and consumption IDs match the existing V1 conventions', () => {
  assert.deepEqual(core.welfarePostingIds('tenant_1', 'sale_1'), {
    welfareId: 'pos_welfare_tenant_1_sale_1',
    expenseId: 'pos_welfare_expense_tenant_1_sale_1',
    transferId: 'pos_welfare_transfer_tenant_1_sale_1'
  });
  assert.equal(core.movementEventId({ saleId: 'sale_1', productId: 'p1' }), 'sales_sale_1_p1_p1');
});

test('canonical envelope validation rejects linkage and amount drift', () => {
  assert.doesNotThrow(() => core.validateEnvelope({ event: {
    eventType: 'POS_SALE_COMMITTED', engineVersion: 2, saleId: 'sale_1', paymentId: 'pay_1', tenantId: 'tenant_1', branchId: 'branch_1', receiptNumber: 'R-1001'
  }, sale, payment }));

  assert.throws(() => core.validateEnvelope({ event: {
    eventType: 'POS_SALE_COMMITTED', engineVersion: 2, saleId: 'sale_1', paymentId: 'pay_1', tenantId: 'tenant_1', branchId: 'branch_1', receiptNumber: 'R-1001'
  }, sale, payment: { ...payment, amount: 14999 } }), /do not reconcile/);
});

test('tier-aware consumption uses immutable base quantity before any live packaging fallback', () => {
  assert.equal(core.snapshotBaseQuantityForItem({ quantity: 2, commercialQuantity: 2, tierCode: 'strip', tierMultiplier: 10, baseQuantity: 20 }), 20);
  assert.equal(core.snapshotBaseQuantityForItem({ quantity: 3, tierCode: 'pack', tierMultiplier: 100 }), 300);
  assert.equal(core.snapshotBaseQuantityForItem({ quantity: 4 }), null);
});
