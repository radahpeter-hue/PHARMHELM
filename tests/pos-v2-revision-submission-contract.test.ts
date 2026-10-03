import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildPosV2RevisionSubmissionRequest,
  posV2RevisionRequestDocumentId
} from '../src/services/pos-v2/posSaleRevisionV2Submission';

const sale: any = {
  id: 'sale-1',
  receiptNumber: 'R-001',
  tenantId: 'tenant-1',
  branchId: 'branch-1',
  engineVersion: 2,
  status: 'completed',
  timestamp: '2026-10-03T10:00:00.000Z',
  paymentMethod: 'cash',
  totalAmount: 10000,
  cashierId: 'seller-1',
  items: [{ productId: 'p1', productName: 'Drug A', quantity: 1, unitPrice: 10000 }]
};

const plan: any = {
  eligible: true,
  originalSaleId: 'sale-1',
  originalReceiptNumber: 'R-001',
  tenantId: 'tenant-1',
  branchId: 'branch-1',
  originalSellerId: 'seller-1',
  originalTimestamp: '2026-10-03T10:00:00.000Z',
  revisionReason: 'Correct quantity entered at sale.',
  originalTotal: 10000,
  revisedTotal: 20000,
  monetaryDelta: 10000,
  adjustmentDirection: 'INCREASE',
  changeTypes: ['QUANTITY_CHANGED'],
  itemChanges: [{
    type: 'QUANTITY_CHANGED',
    productId: 'p1',
    productName: 'Drug A',
    beforeQuantity: 1,
    afterQuantity: 2,
    beforeUnitPrice: 10000,
    afterUnitPrice: 10000
  }],
  before: {
    paymentMethod: 'cash', context: null, patientId: null, institutionId: null, prescriberId: null, discountPercentage: 0
  },
  after: {
    paymentMethod: 'cash', context: null, patientId: null, institutionId: null, prescriberId: null, discountPercentage: 0
  }
};

const revisedItems: any[] = [{ productId: 'p1', productName: 'Drug A', quantity: 2, unitPrice: 10000 }];
const actor = { uid: 'editor-1', name: 'Branch Manager', role: 'branch manager' };

test('submission contract starts as deterministic pending request expected by revision workers', () => {
  const request = buildPosV2RevisionSubmissionRequest({ originalSale: sale, plan, revisedItems, actor });
  assert.equal(request.requestType, 'POS_SALE_REVISION_REQUESTED');
  assert.equal(request.engineVersion, 2);
  assert.equal(request.payloadVersion, 1);
  assert.equal(request.status, 'PENDING');
  assert.equal(request.originalSaleId, sale.id);
  assert.equal(request.originalReceiptNumber, sale.receiptNumber);
  assert.equal(request.tenantId, sale.tenantId);
  assert.equal(request.branchId, sale.branchId);
  assert.equal(request.requestedBy, actor.uid);
  assert.equal(request.requestedByName, actor.name);
  assert.equal(request.reason, plan.revisionReason);
  assert.match(request.requestId, /^pos_revision_request_pos_revision_/);
  assert.equal(posV2RevisionRequestDocumentId(request), request.requestId);
});

test('submission contract preserves canonical replacement identities and reviewed envelope', () => {
  const request = buildPosV2RevisionSubmissionRequest({ originalSale: sale, plan, revisedItems, actor });
  assert.equal(request.pendingReplacementSaleId, request.replacementSaleId);
  assert.equal(request.envelope.identifiers.revisionId, request.revisionId);
  assert.equal(request.envelope.identifiers.replacementAttemptId, request.replacementAttemptId);
  assert.equal(request.envelope.identifiers.replacementSaleId, request.replacementSaleId);
  assert.equal(request.envelope.identifiers.replacementPaymentId, request.replacementPaymentId);
  assert.equal(request.envelope.identifiers.replacementOutboxEventId, request.replacementOutboxEventId);
  assert.equal(request.envelope.revision.reason, request.reason);
  assert.deepEqual(request.revisedItems, revisedItems);
});

test('submission contract fails closed on plan, actor or receipt drift', () => {
  assert.throws(() => buildPosV2RevisionSubmissionRequest({
    originalSale: { ...sale, id: 'wrong-sale' },
    plan,
    revisedItems,
    actor
  } as any), /plan does not belong|identity mismatch/i);

  assert.throws(() => buildPosV2RevisionSubmissionRequest({
    originalSale: sale,
    plan,
    revisedItems: [],
    actor
  }), /at least one item/i);

  assert.throws(() => buildPosV2RevisionSubmissionRequest({
    originalSale: sale,
    plan,
    revisedItems,
    actor: { uid: '', name: '' }
  }), /actor/i);
});

test('submission contract is pure and cannot write Firestore or start checkout/reversal work', () => {
  const source = readFileSync('src/services/pos-v2/posSaleRevisionV2Submission.ts', 'utf8');
  assert.doesNotMatch(source, /firebase\/firestore|setDoc|addDoc|updateDoc|deleteDoc|runTransaction/);
  assert.doesNotMatch(source, /executeCheckoutV2|commitCheckoutV2|executeInventoryAndConsumptionReversal/);
  assert.match(source, /buildPosV2RevisionEnvelope/);
  assert.match(source, /status: 'PENDING'/);
});
