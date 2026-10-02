import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildInitialPosV2RevisionDraft,
  calculatePosV2RevisionDraftTotal
} from '../src/components/sales/PosV2ReceiptRevisionEditor';

const source = readFileSync('src/components/sales/PosV2ReceiptRevisionEditor.tsx', 'utf8');

const sale = {
  id: 'sale-original',
  tenantId: 'tenant-a',
  branchId: 'branch-a',
  receiptNumber: 'MSK-2026-123456',
  timestamp: '2026-10-01T08:00:00.000Z',
  paymentMethod: 'Cash',
  context: 'walk-in',
  patientId: 'patient-1',
  institutionId: null,
  prescriberId: null,
  discountPercentage: 10,
  totalAmount: 27000,
  items: [
    {
      productId: 'product-1',
      productName: 'Medicine A',
      quantity: 2,
      unitPrice: 10000,
      actualUnitPrice: 10000,
      tierCode: 'UNIT'
    },
    {
      productId: 'product-2',
      productName: 'Medicine B',
      quantity: 1,
      unitPrice: 10000,
      actualUnitPrice: 10000,
      tierCode: 'PACK'
    }
  ]
} as any;

test('revision editor seeds a local draft from the immutable original receipt', () => {
  const draft = buildInitialPosV2RevisionDraft(sale);
  assert.equal(draft.paymentMethod, 'Cash');
  assert.equal(draft.context, 'walk-in');
  assert.equal(draft.patientId, 'patient-1');
  assert.equal(draft.discountPercentage, 10);
  assert.equal(draft.revisedTotal, 27000);
  assert.equal(draft.items.length, 2);
  assert.notEqual(draft.items, sale.items);
  assert.notEqual(draft.items[0], sale.items[0]);
});

test('revision draft total follows line quantities prices and sale-level discount', () => {
  const total = calculatePosV2RevisionDraftTotal([
    { productId: 'a', quantity: 3, unitPrice: 5000, actualUnitPrice: 5000 },
    { productId: 'b', quantity: 2, unitPrice: 7500, actualUnitPrice: 7500 }
  ] as any, 10);
  assert.equal(total, 27000);
});

test('editor exposes the agreed revision fields without submitting the transaction', () => {
  assert.match(source, /Payment method/);
  assert.match(source, /Transaction|Context/);
  assert.match(source, /Patient ID/);
  assert.match(source, /Institution ID/);
  assert.match(source, /Prescriber ID/);
  assert.match(source, /Discount %/);
  assert.match(source, /Mandatory revision reason/);
  assert.match(source, /Add Product/);
  assert.match(source, /Continue to Review/);
});

test('editor remains presentation-only and does not write Firestore or invoke checkout', () => {
  assert.doesNotMatch(source, /firebase\/firestore/);
  assert.doesNotMatch(source, /setDoc\s*\(/);
  assert.doesNotMatch(source, /updateDoc\s*\(/);
  assert.doesNotMatch(source, /runTransaction\s*\(/);
  assert.doesNotMatch(source, /executeCheckoutV2\s*\(/);
  assert.doesNotMatch(source, /process-pos-v2-revisions/);
});

test('add-product flow is delegated so the editor cannot fabricate tier or batch snapshots', () => {
  assert.match(source, /onRequestAddItem\?: \(\) => void/);
  assert.match(source, /onClick=\{onRequestAddItem\}/);
  assert.doesNotMatch(source, /product_batches/);
  assert.doesNotMatch(source, /allocateFefo/);
});

test('revision reason uses the authoritative bounded reason policy', () => {
  assert.match(source, /assertRevisionReason/);
  assert.match(source, /const reason = assertRevisionReason\(draft\.reason\)/);
});
