import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPosV2RevisionIdentifiers } from '../src/services/pos-v2/posSaleRevisionV2Envelope';
import { buildPosV2ReplacementCheckoutRequest } from '../src/services/pos-v2/posSaleRevisionV2ReplacementOrchestrator';

function envelope(overrides: Record<string, unknown> = {}) {
  const identifiers = buildPosV2RevisionIdentifiers({
    tenantId: 'tenant-a',
    originalSaleId: 'sale-original',
    sequence: 1
  });
  return {
    identifiers,
    revision: {
      revisionId: identifiers.revisionId,
      tenantId: 'tenant-a',
      branchId: 'branch-a',
      originalSaleId: 'sale-original',
      originalReceiptNumber: 'MSK-2026-123456',
      originalSellerId: 'seller-1',
      originalTimestamp: '2026-10-01T08:00:00.000Z',
      revisedById: 'manager-1',
      revisedByName: 'Branch Manager',
      revisedByRole: 'Branch Manager',
      reason: 'Correct quantity and payment method',
      originalTotal: 10000,
      revisedTotal: 12000,
      monetaryDelta: 2000,
      adjustmentDirection: 'INCREASE',
      changeTypes: ['QUANTITY_CHANGED', 'PAYMENT_METHOD_CHANGED'],
      itemChanges: [],
      before: {
        paymentMethod: 'cash',
        context: 'walk-in',
        patientId: null,
        institutionId: null,
        prescriberId: null,
        discountPercentage: 0
      },
      after: {
        paymentMethod: 'mobile_money',
        context: 'institutional',
        patientId: 'patient-2',
        institutionId: 'institution-2',
        prescriberId: 'prescriber-2',
        discountPercentage: 5
      },
      status: 'PLANNED',
      sequence: 1
    },
    originalSalePatch: {
      revisionLifecycle: 'REVERSAL_PENDING',
      revisionLocked: true,
      revisionId: identifiers.revisionId,
      pendingReplacementSaleId: identifiers.replacementSaleId
    },
    replacementSaleSeed: {
      tenantId: 'tenant-a',
      branchId: 'branch-a',
      engineVersion: 2,
      revisionOfSaleId: 'sale-original',
      revisionId: identifiers.revisionId,
      originalReceiptNumber: 'MSK-2026-123456',
      items: [{ productId: 'product-1', productName: 'Amoxicillin', quantity: 2, commercialQuantity: 2, unitPrice: 6000 }],
      paymentMethod: 'mobile_money',
      context: 'institutional',
      patientId: 'patient-2',
      institutionId: 'institution-2',
      prescriberId: 'prescriber-2',
      discountPercentage: 5,
      totalAmount: 12000
    },
    reversalOutbox: {
      eventId: identifiers.reversalEventId,
      eventType: 'POS_SALE_REVERSAL_REQUESTED',
      tenantId: 'tenant-a',
      branchId: 'branch-a',
      saleId: 'sale-original',
      revisionId: identifiers.revisionId,
      engineVersion: 2,
      status: 'PENDING'
    },
    audit: {
      id: identifiers.auditId,
      tenantId: 'tenant-a',
      branchId: 'branch-a',
      module: 'SALES',
      actionType: 'POS_V2_REVISION',
      objectAffected: 'SALE',
      objectId: 'sale-original',
      receiptId: 'MSK-2026-123456',
      userId: 'manager-1',
      userName: 'Branch Manager',
      userRole: 'Branch Manager',
      reason: 'Correct quantity and payment method'
    },
    ...overrides
  } as any;
}

test('replacement orchestration maps the corrected sale into the canonical POS V2 request', () => {
  const source = envelope();
  const request = buildPosV2ReplacementCheckoutRequest({
    revisionRequestId: 'revision-request-1',
    envelope: source,
    snapshots: {
      patientName: 'Patient Two',
      institutionName: 'Institution Two',
      prescriberName: 'Dr Two',
      customerId: 'customer-2',
      secondaryPaymentMethod: 'cash',
      secondaryAmount: 2000
    }
  });

  assert.equal(request.attemptId, source.identifiers.replacementAttemptId);
  assert.equal(request.branchId, 'branch-a');
  assert.equal(request.items, source.replacementSaleSeed.items);
  assert.equal(request.paymentMethod, 'mobile_money');
  assert.equal(request.context, 'institutional');
  assert.equal(request.patientId, 'patient-2');
  assert.equal(request.institutionId, 'institution-2');
  assert.equal(request.prescriberId, 'prescriber-2');
  assert.equal(request.discountPercentage, 5);
  assert.equal(request.secondaryPaymentMethod, 'cash');
  assert.equal(request.secondaryAmount, 2000);
});

test('replacement orchestration carries the exact immutable revision linkage expected by checkout', () => {
  const source = envelope();
  const request = buildPosV2ReplacementCheckoutRequest({
    revisionRequestId: 'revision-request-1',
    envelope: source
  });

  assert.deepEqual(request.revisionReplacement, {
    revisionId: source.identifiers.revisionId,
    revisionRequestId: 'revision-request-1',
    sequence: 1,
    originalSaleId: 'sale-original',
    originalReceiptNumber: 'MSK-2026-123456',
    replacementSaleId: source.identifiers.replacementSaleId,
    replacementPaymentId: source.identifiers.replacementPaymentId,
    replacementOutboxEventId: source.identifiers.replacementOutboxEventId
  });
});

test('replacement orchestration fails closed on revision, original-sale and tenant drift', () => {
  const base = envelope();
  assert.throws(() => buildPosV2ReplacementCheckoutRequest({
    revisionRequestId: 'revision-request-1',
    envelope: envelope({ replacementSaleSeed: { ...base.replacementSaleSeed, revisionId: 'other-revision' } })
  }), /revision identity mismatch/i);

  assert.throws(() => buildPosV2ReplacementCheckoutRequest({
    revisionRequestId: 'revision-request-1',
    envelope: envelope({ replacementSaleSeed: { ...base.replacementSaleSeed, revisionOfSaleId: 'other-sale' } })
  }), /original sale identity mismatch/i);

  assert.throws(() => buildPosV2ReplacementCheckoutRequest({
    revisionRequestId: 'revision-request-1',
    envelope: envelope({ replacementSaleSeed: { ...base.replacementSaleSeed, tenantId: 'tenant-b' } })
  }), /tenant or branch identity mismatch/i);
});

test('replacement orchestration refuses incomplete durable identity and never performs Firestore writes itself', () => {
  const source = envelope();
  assert.throws(() => buildPosV2ReplacementCheckoutRequest({ revisionRequestId: '', envelope: source }), /durable revision request ID/i);

  const sourceText = require('node:fs').readFileSync('src/services/pos-v2/posSaleRevisionV2ReplacementOrchestrator.ts', 'utf8');
  assert.doesNotMatch(sourceText, /runTransaction|transaction\.set|transaction\.update|setDoc|updateDoc/);
  assert.match(sourceText, /executeCheckoutV2/);
});
