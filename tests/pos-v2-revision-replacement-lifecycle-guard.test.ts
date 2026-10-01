import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePosCheckoutV2ReplacementOriginalLifecycle } from '../src/services/pos-v2/posCheckoutV2RevisionReplacementGuard';

const context = {
  revisionId: 'rev-1',
  revisionRequestId: 'request-1',
  sequence: 1,
  originalSaleId: 'sale-original',
  originalReceiptNumber: 'MSK-2026-123456',
  replacementSaleId: 'sale-replacement',
  replacementPaymentId: 'payment-replacement',
  replacementOutboxEventId: 'outbox-replacement'
};

function originalSale(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sale-original',
    tenantId: 'tenant-a',
    branchId: 'branch-a',
    receiptNumber: 'MSK-2026-123456',
    engineVersion: 2,
    status: 'completed',
    revisionLocked: true,
    revisionId: 'rev-1',
    revisionLifecycle: 'REPLACEMENT_PENDING',
    pendingReplacementSaleId: 'sale-replacement',
    ...overrides
  };
}

function validate(overrides: Record<string, unknown> = {}) {
  return validatePosCheckoutV2ReplacementOriginalLifecycle({
    context,
    originalSale: originalSale(overrides),
    tenantId: 'tenant-a',
    branchId: 'branch-a',
    preparedSaleId: 'sale-replacement'
  });
}

test('replacement checkout accepts only the same fully reversed original sale lock', () => {
  assert.doesNotThrow(() => validate());
});

test('replacement checkout fails closed before reversal reaches replacement pending', () => {
  assert.throws(() => validate({ revisionLifecycle: 'REVERSAL_PENDING' }), /not ready for replacement/i);
});

test('replacement checkout rejects revision, receipt and replacement identity drift', () => {
  assert.throws(() => validate({ revisionId: 'other-revision' }), /revision lock/i);
  assert.throws(() => validate({ receiptNumber: 'OTHER-RECEIPT' }), /receipt identity/i);
  assert.throws(() => validate({ pendingReplacementSaleId: 'other-sale' }), /replacement identity/i);
});

test('replacement checkout cannot cross tenant or branch and cannot replace a non-v2 sale', () => {
  assert.throws(() => validate({ tenantId: 'tenant-b' }), /tenant or branch/i);
  assert.throws(() => validate({ branchId: 'branch-b' }), /tenant or branch/i);
  assert.throws(() => validate({ engineVersion: 1 }), /completed POS V2 sale/i);
});

test('replacement checkout rejects an already superseded original sale', () => {
  assert.throws(() => validate({ supersededBySaleId: 'sale-already-created' }), /already been superseded/i);
});
