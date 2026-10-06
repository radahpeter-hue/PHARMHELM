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
  timestamp: '2026-10-03T00:00:00.000Z',
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

const requestCreatedAt = new Date('2026-10-04T00:00:00.000Z');

function validate(overrides: Record<string, unknown> = {}) {
  return core.validateRevisionRequest({ request, sale, payment, outbox, requestCreatedAt, ...overrides });
}

test('canonical processed V2 chain accepts one new revision request', () => {
  assert.equal(validate(), true);
});

test('revision validation does not require or mutate a new sale status', () => {
  const snapshot = structuredClone(sale);
  validate();
  assert.equal(sale.status, 'completed');
  assert.deepEqual(sale, snapshot);
});

test('new revision request must be claimed within the 72-hour revision window', () => {
  assert.equal(core.REVISION_WINDOW_HOURS, 72);
  assert.equal(validate({ requestCreatedAt: new Date('2026-10-05T23:59:59.999Z') }), true);
  assert.throws(
    () => validate({ requestCreatedAt: new Date('2026-10-06T00:00:00.001Z') }),
    /outside the 72-hour revision window/
  );
  assert.throws(
    () => validate({ requestCreatedAt: new Date('2026-10-02T23:59:59.999Z') }),
    /outside the 72-hour revision window/
  );
});

test('a legitimate revision retry may finish after the 72-hour window once its own lock exists', () => {
  const ownPendingLock = {
    ...sale,
    revisionLocked: true,
    revisionId: 'revision_1',
    revisionLifecycle: 'REVERSAL_PENDING'
  };
  assert.equal(
    validate({ sale: ownPendingLock, requestCreatedAt: new Date('2026-10-20T00:00:00.000Z'), resume: true }),
    true
  );
});

test('revision request fails closed until original downstream posting is fully processed', () => {
  assert.throws(
    () => validate({ outbox: { ...outbox, status: 'PROCESSING' } }),
    /finish downstream posting/
  );
});

test('revision request rejects cross-tenant, cross-branch and receipt drift', () => {
  assert.throws(
    () => validate({ request: { ...request, tenantId: 'tenant_2' } }),
    /tenant linkage mismatch/
  );
  assert.throws(
    () => validate({ request: { ...request, branchId: 'branch_2' } }),
    /branch linkage mismatch/
  );
  assert.throws(
    () => validate({ request: { ...request, originalReceiptNumber: 'OTHER' } }),
    /receipt linkage mismatch/
  );
});

test('revision request rejects an already locked or superseded sale', () => {
  assert.throws(
    () => validate({ sale: { ...sale, revisionLocked: true } }),
    /already locked/
  );
  assert.throws(
    () => validate({ sale: { ...sale, supersededBySaleId: 'replacement_1' } }),
    /already locked/
  );
});

test('revision retry can resume only its own pending reversal lock', () => {
  const ownPendingLock = {
    ...sale,
    revisionLocked: true,
    revisionId: 'revision_1',
    revisionLifecycle: 'REVERSAL_PENDING'
  };
  assert.equal(validate({ sale: ownPendingLock, resume: true }), true);

  assert.throws(
    () => validate({
      sale: { ...ownPendingLock, revisionId: 'revision_other' },
      resume: true
    }),
    /already locked/
  );
  assert.throws(
    () => validate({
      sale: { ...ownPendingLock, revisionLifecycle: 'REVERSAL_COMPLETE' },
      resume: true
    }),
    /already locked/
  );
  assert.throws(
    () => validate({
      sale: { ...ownPendingLock, supersededBySaleId: 'replacement_1' },
      resume: true
    }),
    /already locked/
  );
});

test('revision request cannot masquerade as a normal sale commit or use a weak reason', () => {
  assert.throws(
    () => validate({ request: { ...request, requestType: 'POS_SALE_COMMITTED' } }),
    /Unsupported POS revision request/
  );
  assert.throws(
    () => validate({ request: { ...request, reason: 'short' } }),
    /8 to 500/
  );
});

test('reversal consumers preserve completed work across retries', () => {
  const consumers = core.initializeReversalConsumers(
    { inventory: true, consumption: true, payment: true, welfare: false, institutionalCredit: false, quotation: false },
    { inventory: { status: 'COMPLETED', attemptCount: 1, lastError: null } }
  );
  assert.equal(consumers.inventory.status, 'COMPLETED');
  assert.equal(consumers.inventory.attemptCount, 1);
  assert.equal(consumers.consumption.status, 'PENDING');
  assert.equal(consumers.payment.status, 'PENDING');
  assert.equal(consumers.welfare.status, 'NOT_APPLICABLE');
});

test('payment compensation is an explicit required consumer before reversal can complete', () => {
  const consumers = core.initializeReversalConsumers({ inventory: true, consumption: true, payment: true });
  consumers.inventory.status = 'COMPLETED';
  consumers.consumption.status = 'COMPLETED';
  assert.equal(core.deriveReversalState(consumers), 'PENDING');
  consumers.payment.status = 'PROCESSING';
  assert.equal(core.deriveReversalState(consumers), 'PROCESSING');
  consumers.payment.status = 'COMPLETED';
  assert.equal(core.deriveReversalState(consumers), 'REVERSAL_COMPLETE');
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

test('revision lifecycle follows reversal, replacement creation and completion in order', () => {
  assert.equal(core.assertRevisionTransition('PENDING', 'PROCESSING'), true);
  assert.equal(core.assertRevisionTransition('PROCESSING', 'REVERSAL_COMPLETE'), true);
  assert.equal(core.assertRevisionTransition('REVERSAL_COMPLETE', 'REPLACEMENT_PENDING'), true);
  assert.equal(core.assertRevisionTransition('REPLACEMENT_PENDING', 'REPLACEMENT_CREATED'), true);
  assert.equal(core.assertRevisionTransition('REPLACEMENT_CREATED', 'COMPLETED'), true);
  assert.equal(core.assertRevisionTransition('FAILED', 'PROCESSING'), true);
  assert.throws(() => core.assertRevisionTransition('PENDING', 'COMPLETED'), /Illegal POS revision transition/);
  assert.throws(() => core.assertRevisionTransition('REPLACEMENT_PENDING', 'COMPLETED'), /Illegal POS revision transition/);
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
