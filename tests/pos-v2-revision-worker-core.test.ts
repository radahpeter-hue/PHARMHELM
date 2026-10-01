import test from 'node:test';
import assert from 'node:assert/strict';

const core = await import('../scripts/pos-v2-revision-worker-core.mjs');

const sale = {
  id: 'sale_1',
  tenantId: 'tenant_1',
  branchId: 'branch_1',
  receiptNumber: 'R-1001',
  engineVersion: 2,
  status: 'completed',
  totalAmount: 15000,
  canonicalPaymentId: 'pay_1',
  transactionOutboxEventId: 'outbox_1'
};

const payment = {
  paymentId: 'pay_1',
  saleId: 'sale_1',
  tenantId: 'tenant_1',
  branchId: 'branch_1',
  receiptNumber: 'R-1001',
  engineVersion: 2,
  amount: 15000
};

const outbox = {
  eventId: 'outbox_1',
  eventType: 'POS_SALE_COMMITTED',
  saleId: 'sale_1',
  paymentId: 'pay_1',
  tenantId: 'tenant_1',
  branchId: 'branch_1',
  receiptNumber: 'R-1001',
  engineVersion: 2,
  status: 'PROCESSED'
};

const request = {
  requestId: 'revision_request_1',
  requestType: 'POS_SALE_REVISION_REQUESTED',
  revisionId: 'revision_1',
  engineVersion: 2,
  payloadVersion: 1,
  status: 'PENDING',
  tenantId: 'tenant_1',
  branchId: 'branch_1',
  originalSaleId: 'sale_1',
  originalReceiptNumber: 'R-1001',
  requestedBy: 'manager_1',
  requestedByName: 'Branch Manager',
  reason: 'Quantity entered incorrectly'
};

test('canonical processed V2 chain accepts one new revision request', () => {
  assert.equal(core.validateRevisionRequest({ request, sale, payment, outbox }), true);
});

test('revision validation does not require or mutate a new sale status', () => {
  const snapshot = structuredClone(sale);
  core.validateRevisionRequest({ request, sale, payment, outbox });
  assert.equal(sale.status, 'completed');
  assert.deepEqual(sale, snapshot);
});

test('revision request fails closed until original downstream posting is fully processed', () => {
  assert.throws(
    () => core.validateRevisionRequest({ request, sale, payment, outbox: { ...outbox, status: 'PROCESSING' } }),
    /finish downstream posting/
  );
});

test('revision request rejects cross-tenant, cross-branch and receipt drift', () => {
  assert.throws(
    () => core.validateRevisionRequest({ request: { ...request, tenantId: 'tenant_2' }, sale, payment, outbox }),
    /tenant linkage mismatch/
  );
  assert.throws(
    () => core.validateRevisionRequest({ request: { ...request, branchId: 'branch_2' }, sale, payment, outbox }),
    /branch linkage mismatch/
  );
  assert.throws(
    () => core.validateRevisionRequest({ request: { ...request, originalReceiptNumber: 'OTHER' }, sale, payment, outbox }),
    /receipt linkage mismatch/
  );
});

test('revision request rejects an already locked or superseded sale', () => {
  assert.throws(
    () => core.validateRevisionRequest({ request, sale: { ...sale, revisionLocked: true }, payment, outbox }),
    /already locked/
  );
  assert.throws(
    () => core.validateRevisionRequest({ request, sale: { ...sale, supersededBySaleId: 'replacement_1' }, payment, outbox }),
    /already locked/
  );
});

test('revision request cannot masquerade as a normal sale commit or use a weak reason', () => {
  assert.throws(
    () => core.validateRevisionRequest({ request: { ...request, requestType: 'POS_SALE_COMMITTED' }, sale, payment, outbox }),
    /Unsupported POS revision request/
  );
  assert.throws(
    () => core.validateRevisionRequest({ request: { ...request, reason: 'short' }, sale, payment, outbox }),
    /8 to 500/
  );
});

test('reversal consumers preserve completed work across retries', () => {
  const consumers = core.initializeReversalConsumers(
    { inventory: true, consumption: true, welfare: false, institutionalCredit: false, quotation: false },
    { inventory: { status: 'COMPLETED', attemptCount: 1, lastError: null } }
  );
  assert.equal(consumers.inventory.status, 'COMPLETED');
  assert.equal(consumers.inventory.attemptCount, 1);
  assert.equal(consumers.consumption.status, 'PENDING');
  assert.equal(consumers.welfare.status, 'NOT_APPLICABLE');
});

test('reversal state becomes complete only when every applicable consumer completes', () => {
  const consumers = core.initializeReversalConsumers({ inventory: true, consumption: true });
  assert.equal(core.deriveReversalState(consumers), 'PENDING');
  consumers.inventory.status = 'COMPLETED';
  consumers.consumption.status = 'PROCESSING';
  assert.equal(core.deriveReversalState(consumers), 'PROCESSING');
  consumers.consumption.status = 'COMPLETED';
  assert.equal(core.deriveReversalState(consumers), 'REVERSAL_COMPLETE');
});

test('revision lifecycle prevents premature completion and permits controlled retry', () => {
  assert.equal(core.assertRevisionTransition('PENDING', 'PROCESSING'), true);
  assert.equal(core.assertRevisionTransition('PROCESSING', 'REVERSAL_COMPLETE'), true);
  assert.equal(core.assertRevisionTransition('REVERSAL_COMPLETE', 'REPLACEMENT_PENDING'), true);
  assert.equal(core.assertRevisionTransition('REPLACEMENT_PENDING', 'COMPLETED'), true);
  assert.equal(core.assertRevisionTransition('FAILED', 'PROCESSING'), true);
  assert.throws(() => core.assertRevisionTransition('PENDING', 'COMPLETED'), /Illegal POS revision transition/);
  assert.throws(() => core.assertRevisionTransition('REVERSAL_COMPLETE', 'COMPLETED'), /Illegal POS revision transition/);
});

test('revision reversal and audit IDs are deterministic and revision scoped', () => {
  const first = core.revisionMovementEventId({ originalSaleId: 'sale_1', productId: 'p1', revisionId: 'revision_1' });
  const replay = core.revisionMovementEventId({ originalSaleId: 'sale_1', productId: 'p1', revisionId: 'revision_1' });
  const second = core.revisionMovementEventId({ originalSaleId: 'sale_1', productId: 'p1', revisionId: 'revision_2' });
  assert.equal(first, replay);
  assert.notEqual(first, second);
  assert.equal(core.revisionAuditId({ originalSaleId: 'sale_1', revisionId: 'revision_1' }), 'audit_pos_revision_sale_1_revision_1');
});
