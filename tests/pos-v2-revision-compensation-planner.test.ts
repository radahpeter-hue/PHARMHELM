import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPosV2CompensationPlan } from '../src/services/pos-v2/posSaleRevisionV2CompensationPlanner';

const sale = (overrides: Record<string, unknown> = {}) => ({
  id: 'sale-v2-1',
  tenantId: 'tenant-1',
  branchId: 'branch-1',
  receiptNumber: 'BR-001-2026-000001',
  timestamp: '2026-10-01T08:00:00.000Z',
  engineVersion: 2,
  status: 'completed',
  cashierId: 'seller-1',
  subtotal: 51000,
  tax: 0,
  total: 51000,
  totalAmount: 51000,
  paymentMethod: 'cash',
  canonicalPaymentId: 'pay-1',
  transactionOutboxEventId: 'outbox-1',
  items: [
    {
      productId: 'p1',
      batchId: 'b1',
      name: 'Product One',
      productName: 'Product One',
      quantity: 3,
      commercialQuantity: 3,
      unitPrice: 1000,
      total: 3000,
      tierCode: 'UNIT',
      tierMultiplier: 1,
      baseQuantity: 3,
      batchAllocations: [
        { batchId: 'b1', batchNumber: 'B-001', baseQuantity: 2, costPerBaseUnit: 400 },
        { batchId: 'b2', batchNumber: 'B-002', baseQuantity: 1, costPerBaseUnit: 450 }
      ]
    },
    {
      productId: 'p2',
      batchId: 'b3',
      name: 'Product Two',
      productName: 'Product Two',
      quantity: 4,
      commercialQuantity: 2,
      unitPrice: 24000,
      total: 48000,
      tierCode: 'STRIP',
      tierMultiplier: 2,
      baseQuantity: 4,
      batchAllocations: [
        { batchId: 'b3', batchNumber: 'B-003', baseQuantity: 4, costPerBaseUnit: 5000 }
      ]
    }
  ],
  ...overrides
}) as any;

const payment = (overrides: Record<string, unknown> = {}) => ({
  paymentId: 'pay-1',
  saleId: 'sale-v2-1',
  receiptNumber: 'BR-001-2026-000001',
  checkoutAttemptId: 'attempt-1',
  tenantId: 'tenant-1',
  branchId: 'branch-1',
  paymentMethod: 'cash',
  currency: 'UGX',
  amount: 51000,
  settledAmount: 51000,
  outstandingAmount: 0,
  status: 'completed',
  components: [{ method: 'cash', amount: 51000, settledAmount: 51000, outstandingAmount: 0, status: 'settled' }],
  operatorUid: 'seller-1',
  source: 'POS',
  engineVersion: 2,
  ...overrides
}) as any;

const outbox = (overrides: Record<string, unknown> = {}) => ({
  eventId: 'outbox-1',
  eventType: 'POS_SALE_COMMITTED',
  saleId: 'sale-v2-1',
  paymentId: 'pay-1',
  receiptNumber: 'BR-001-2026-000001',
  tenantId: 'tenant-1',
  branchId: 'branch-1',
  engineVersion: 2,
  status: 'PROCESSED',
  consumers: {
    consumption: { status: 'COMPLETED' },
    welfare: { status: 'NOT_APPLICABLE' },
    institutionalCredit: { status: 'NOT_APPLICABLE' },
    quotation: { status: 'NOT_APPLICABLE' }
  },
  ...overrides
});

test('compensation planner restores exact historical batches and product totals', () => {
  const plan = buildPosV2CompensationPlan({ sale: sale(), payment: payment(), outbox: outbox() });

  assert.equal(plan.totalBaseUnitsReturned, 7);
  assert.deepEqual(plan.batchRestores, [
    { batchId: 'b1', batchNumber: 'B-001', productId: 'p1', baseQuantity: 2 },
    { batchId: 'b2', batchNumber: 'B-002', productId: 'p1', baseQuantity: 1 },
    { batchId: 'b3', batchNumber: 'B-003', productId: 'p2', baseQuantity: 4 }
  ]);
  assert.deepEqual(plan.productRestores, [
    { productId: 'p1', baseQuantity: 3 },
    { productId: 'p2', baseQuantity: 4 }
  ]);
  assert.equal(plan.downstream.consumption, true);
  assert.equal(plan.financial.paymentAmount, 51000);
});

test('service lines are ignored by stock compensation', () => {
  const value = sale({
    items: [
      ...sale().items,
      { productId: 'svc', batchId: '', name: 'Consultation', quantity: 1, unitPrice: 10000, total: 10000, isService: true }
    ],
    total: 61000,
    totalAmount: 61000
  });
  const pay = payment({ amount: 61000, settledAmount: 61000, components: [{ method: 'cash', amount: 61000, settledAmount: 61000, outstandingAmount: 0, status: 'settled' }] });
  const plan = buildPosV2CompensationPlan({ sale: value, payment: pay, outbox: outbox() });
  assert.equal(plan.totalBaseUnitsReturned, 7);
  assert.equal(plan.productRestores.some(row => row.productId === 'svc'), false);
});

test('planner fails closed when immutable batch allocations are missing', () => {
  const value = sale({ items: [{ ...sale().items[0], batchAllocations: [] }] });
  assert.throws(
    () => buildPosV2CompensationPlan({ sale: value, payment: payment(), outbox: outbox() }),
    /Exact historical batch allocations are missing/
  );
});

test('planner fails closed when allocation totals do not match immutable base quantity', () => {
  const item = { ...sale().items[0], baseQuantity: 5 };
  const value = sale({ items: [item] });
  assert.throws(
    () => buildPosV2CompensationPlan({ sale: value, payment: payment(), outbox: outbox() }),
    /Historical allocation quantity does not reconcile/
  );
});

test('planner rejects canonical payment or outbox linkage drift', () => {
  assert.throws(
    () => buildPosV2CompensationPlan({ sale: sale(), payment: payment({ saleId: 'other-sale' }), outbox: outbox() }),
    /Canonical sale linkage mismatch/
  );
  assert.throws(
    () => buildPosV2CompensationPlan({ sale: sale(), payment: payment(), outbox: outbox({ paymentId: 'other-pay' }) }),
    /Canonical payment linkage mismatch/
  );
});

test('planner requires original downstream processing to finish before compensation', () => {
  assert.throws(
    () => buildPosV2CompensationPlan({ sale: sale(), payment: payment(), outbox: outbox({ status: 'PROCESSING' }) }),
    /must be fully PROCESSED/
  );
});

test('planner marks welfare, institutional credit and quotation compensation requirements', () => {
  const value = sale({ sourceQuotationId: 'quote-1', paymentMethod: 'staff_welfare' });
  const pay = payment({
    paymentMethod: 'staff_welfare',
    components: [
      { method: 'staff_welfare', amount: 11000, settledAmount: 11000, outstandingAmount: 0, status: 'settled' },
      { method: 'institutional_credit', amount: 40000, settledAmount: 0, outstandingAmount: 40000, status: 'unpaid' }
    ],
    settledAmount: 11000,
    outstandingAmount: 40000,
    status: 'partially_settled'
  });
  const event = outbox({
    consumers: {
      consumption: { status: 'COMPLETED' },
      welfare: { status: 'COMPLETED' },
      institutionalCredit: { status: 'COMPLETED' },
      quotation: { status: 'COMPLETED' }
    }
  });

  const plan = buildPosV2CompensationPlan({ sale: value, payment: pay, outbox: event });
  assert.equal(plan.financial.requiresWelfareReversal, true);
  assert.equal(plan.financial.requiresInstitutionalCreditReversal, true);
  assert.equal(plan.financial.requiresQuotationReversal, true);
  assert.deepEqual(plan.downstream, {
    consumption: true,
    welfare: true,
    institutionalCredit: true,
    quotation: true
  });
});
