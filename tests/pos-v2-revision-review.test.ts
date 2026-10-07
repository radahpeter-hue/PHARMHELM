import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPosV2RevisionPlan } from '../src/services/pos-v2/posSaleRevisionV2Planner';

const source = readFileSync('src/components/sales/PosV2ReceiptRevisionReview.tsx', 'utf8');

const originalSale = {
  id: 'sale-original',
  engineVersion: 2,
  status: 'completed',
  tenantId: 'tenant-a',
  branchId: 'branch-a',
  receiptNumber: 'MSK-2026-123456',
  timestamp: '2026-10-01T08:00:00.000Z',
  paymentMethod: 'Cash',
  context: 'walk-in',
  patientId: 'patient-1',
  institutionId: null,
  prescriberId: null,
  discountPercentage: 0,
  totalAmount: 20000,
  cashierId: 'seller-1',
  items: [
    {
      productId: 'product-1',
      productName: 'Medicine A',
      quantity: 2,
      unitPrice: 10000,
      actualUnitPrice: 10000,
      tierCode: 'UNIT'
    }
  ]
} as any;

test('review screen delegates authoritative comparison to the certified revision planner', () => {
  assert.match(source, /buildPosV2RevisionPlan/);
  assert.match(source, /revisedItems: draft\.items/);
  assert.match(source, /revisedTotal: draft\.revisedTotal/);
  assert.match(source, /reason: draft\.reason/);
});

test('revision review presents original corrected monetary and contextual differences', () => {
  assert.match(source, /Original total/);
  assert.match(source, /Corrected total/);
  assert.match(source, /Monetary adjustment/);
  assert.match(source, /Detected changes/);
  assert.match(source, /Original receipt context/);
  assert.match(source, /Corrected receipt context/);
  assert.match(source, /Mandatory revision reason/);
});

test('planner feeding review detects item and context changes without mutating original identity', () => {
  const plan = buildPosV2RevisionPlan({
    originalSale,
    revisedItems: [
      { ...originalSale.items[0], quantity: 1 },
      {
        productId: 'product-2',
        productName: 'Medicine B',
        quantity: 1,
        unitPrice: 5000,
        actualUnitPrice: 5000,
        tierCode: 'PACK'
      }
    ] as any,
    revisedTotal: 15000,
    paymentMethod: 'mtn_momo',
    context: 'telepharmacy',
    patientId: 'patient-2',
    patientName: 'Patient Two',
    institutionId: null,
    prescriberId: 'prescriber-1',
    prescriberName: 'Dr Prescriber',
    discountPercentage: 0,
    reason: 'Customer payment and item details were captured incorrectly at checkout.',
    now: new Date('2026-10-02T08:00:00.000Z')
  });

  assert.equal(plan.originalSaleId, 'sale-original');
  assert.equal(plan.originalReceiptNumber, 'MSK-2026-123456');
  assert.equal(plan.originalTotal, 20000);
  assert.equal(plan.revisedTotal, 15000);
  assert.equal(plan.monetaryDelta, -5000);
  assert.equal(plan.adjustmentDirection, 'DECREASE');
  assert.ok(plan.changeTypes.includes('QUANTITY_CHANGED'));
  assert.ok(plan.changeTypes.includes('ITEM_ADDED'));
  assert.ok(plan.changeTypes.includes('PAYMENT_METHOD_CHANGED'));
  assert.ok(plan.changeTypes.includes('CONTEXT_CHANGED'));
  assert.ok(plan.changeTypes.includes('PATIENT_CHANGED'));
  assert.ok(plan.changeTypes.includes('PRESCRIBER_CHANGED'));
  assert.equal(originalSale.items[0].quantity, 2);
  assert.equal(originalSale.paymentMethod, 'Cash');
});

test('review screen remains fail-closed and mutation-free', () => {
  assert.match(source, /Revision review failed closed/);
  assert.match(source, /disabled=\{!plan \|\| isSubmitting\}/);
  assert.doesNotMatch(source, /firebase\/firestore/);
  assert.doesNotMatch(source, /executeCheckoutV2\s*\(/);
  assert.doesNotMatch(source, /setDoc\s*\(/);
  assert.doesNotMatch(source, /updateDoc\s*\(/);
  assert.doesNotMatch(source, /runTransaction\s*\(/);
});

test('review confirmation hands the certified plan and draft to immediate correction', () => {
  assert.match(source, /onConfirm: \(plan: PosV2RevisionPlan, draft: PosV2ReceiptRevisionDraft\) => void/);
  assert.match(source, /onClick=\{\(\) => plan && onConfirm\(plan, draft\)\}/);
  assert.match(source, /Save and Print Correction/);
  assert.match(source, /original receipt is preserved/i);
  assert.match(source, /ready to print after saving/i);
});


test('light receipt editor and review panels override inherited white text and describe immediate correction', () => {
  const editor = readFileSync('src/components/sales/PosV2ReceiptRevisionEditor.tsx', 'utf8');
  assert.match(source, /bg-white text-zinc-900 shadow-2xl/);
  assert.match(editor, /bg-white text-zinc-900 shadow-2xl/);
  assert.match(source, /Save and Print Correction/);
  assert.match(source, /updates stock and accounts together/);
  assert.doesNotMatch(source, /controlled revision workers|worker begins reversal/);
});
