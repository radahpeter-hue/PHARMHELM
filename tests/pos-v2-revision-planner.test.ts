import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPosV2RevisionPlan } from '../src/services/pos-v2/posSaleRevisionV2Planner';

const sale = (overrides: Record<string, unknown> = {}) => ({
  id: 'sale-1',
  tenantId: 'tenant-1',
  branchId: 'branch-1',
  receiptNumber: 'MSK-2026-000001',
  timestamp: '2026-09-30T10:00:00.000Z',
  engineVersion: 2,
  status: 'completed',
  cashierId: 'seller-1',
  paymentMethod: 'cash',
  context: 'walk-in',
  patientId: null,
  institutionId: null,
  prescriberId: null,
  discountPercentage: 0,
  subtotal: 51000,
  tax: 0,
  total: 51000,
  totalAmount: 51000,
  items: [
    {
      productId: 'p1',
      productName: 'Amoxicillin',
      quantity: 1,
      baseQuantity: 1,
      unitPrice: 1000,
      actualUnitPrice: 1000,
      tierCode: 'UNIT'
    },
    {
      productId: 'p2',
      productName: 'Vitamin C',
      quantity: 100,
      baseQuantity: 100,
      unitPrice: 500,
      actualUnitPrice: 500,
      tierCode: 'UNIT'
    }
  ],
  ...overrides
}) as any;

const now = new Date('2026-10-01T10:00:00.000Z');

test('planner records quantity reduction and monetary decrease without mutating original identity', () => {
  const original = sale();
  const revisedItems = [original.items[0], { ...original.items[1], quantity: 80, baseQuantity: 80 }];
  const plan = buildPosV2RevisionPlan({
    originalSale: original,
    revisedItems,
    revisedTotal: 41000,
    reason: 'Incorrect Vitamin C quantity entered',
    now
  });

  assert.equal(plan.originalSaleId, 'sale-1');
  assert.equal(plan.originalReceiptNumber, 'MSK-2026-000001');
  assert.equal(plan.originalSellerId, 'seller-1');
  assert.equal(plan.monetaryDelta, -10000);
  assert.equal(plan.adjustmentDirection, 'DECREASE');
  assert.ok(plan.changeTypes.includes('QUANTITY_CHANGED'));
  assert.deepEqual(plan.itemChanges.find(change => change.productId === 'p2'), {
    type: 'QUANTITY_CHANGED',
    productId: 'p2',
    productName: 'Vitamin C',
    tierCode: 'UNIT',
    beforeQuantity: 100,
    afterQuantity: 80,
    beforeUnitPrice: 500,
    afterUnitPrice: 500
  });
});

test('planner detects product add/remove, payment, context, patient, institution and discount changes', () => {
  const original = sale();
  const revisedItems = [
    { ...original.items[1], quantity: 90 },
    { productId: 'p3', productName: 'ORS', quantity: 2, unitPrice: 1500, actualUnitPrice: 1500, tierCode: 'UNIT' }
  ];
  const plan = buildPosV2RevisionPlan({
    originalSale: original,
    revisedItems,
    revisedTotal: 48000,
    paymentMethod: 'mtn_momo',
    context: 'institutional',
    patientId: 'patient-9',
    patientName: 'Patient Nine',
    institutionId: 'inst-2',
    institutionName: 'Institution Two',
    institutionBillingEligible: true,
    discountPercentage: 5,
    reason: 'Wrong client and payment context selected',
    now
  });

  for (const change of [
    'ITEM_REMOVED',
    'ITEM_ADDED',
    'QUANTITY_CHANGED',
    'PAYMENT_METHOD_CHANGED',
    'CONTEXT_CHANGED',
    'PATIENT_CHANGED',
    'INSTITUTION_CHANGED',
    'DISCOUNT_CHANGED'
  ]) assert.ok(plan.changeTypes.includes(change as any), change);
});

test('planner preserves no-value-change revisions when non-monetary context changes', () => {
  const original = sale();
  const plan = buildPosV2RevisionPlan({
    originalSale: original,
    revisedItems: original.items,
    revisedTotal: 51000,
    patientId: 'patient-1',
    patientName: 'Patient One',
    reason: 'Attach correct patient to completed receipt',
    now
  });

  assert.equal(plan.adjustmentDirection, 'NO_VALUE_CHANGE');
  assert.equal(plan.monetaryDelta, 0);
  assert.deepEqual(plan.changeTypes, ['PATIENT_CHANGED']);
});

test('planner fails closed after 72 hours and on already-revised or voided receipts', () => {
  assert.throws(() => buildPosV2RevisionPlan({
    originalSale: sale(),
    revisedItems: sale().items,
    revisedTotal: 50000,
    reason: 'Correct sale value after review',
    now: new Date('2026-10-03T10:00:00.001Z')
  }), /REVISION_WINDOW_EXPIRED/);

  assert.throws(() => buildPosV2RevisionPlan({
    originalSale: sale({ supersededBySaleId: 'sale-2' }),
    revisedItems: sale().items,
    revisedTotal: 50000,
    reason: 'Correct sale value after review',
    now
  }), /ALREADY_REVISED/);

  assert.throws(() => buildPosV2RevisionPlan({
    originalSale: sale({ status: 'voided' }),
    revisedItems: sale().items,
    revisedTotal: 50000,
    reason: 'Correct sale value after review',
    now
  }), /ALREADY_VOIDED/);
});

test('planner requires a real change, valid revised total and at least one line item', () => {
  const original = sale();
  assert.throws(() => buildPosV2RevisionPlan({
    originalSale: original,
    revisedItems: original.items,
    revisedTotal: 51000,
    reason: 'No actual change requested',
    now
  }), /does not contain any changes/);

  assert.throws(() => buildPosV2RevisionPlan({
    originalSale: original,
    revisedItems: [],
    revisedTotal: 0,
    reason: 'Remove all receipt lines',
    now
  }), /at least one line item/);

  assert.throws(() => buildPosV2RevisionPlan({
    originalSale: original,
    revisedItems: original.items,
    revisedTotal: -1,
    reason: 'Correct invalid negative sale total',
    now
  }), /valid non-negative/);
});
