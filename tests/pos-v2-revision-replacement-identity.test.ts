import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPosV2RevisionIdentifiers } from '../src/services/pos-v2/posSaleRevisionV2Envelope';
import { checkoutV2SaleDocumentId } from '../src/services/pos-v2/posCheckoutV2Identity';
import {
  posCheckoutV2OutboxEventDocumentId,
  posCheckoutV2PaymentDocumentId
} from '../src/services/pos-v2/posCheckoutV2PaymentOutbox';

test('revision replacement identities are derived from the canonical POS V2 checkout identity contract', () => {
  const identifiers = buildPosV2RevisionIdentifiers({
    tenantId: 'tenant-a',
    originalSaleId: 'sale-original-123',
    sequence: 1
  });

  assert.equal(
    identifiers.replacementSaleId,
    checkoutV2SaleDocumentId('tenant-a', identifiers.replacementAttemptId)
  );
  assert.equal(
    identifiers.replacementPaymentId,
    posCheckoutV2PaymentDocumentId(identifiers.replacementSaleId)
  );
  assert.equal(
    identifiers.replacementOutboxEventId,
    posCheckoutV2OutboxEventDocumentId(identifiers.replacementSaleId)
  );
});

test('revision replacement identities are deterministic and sequence-specific', () => {
  const first = buildPosV2RevisionIdentifiers({ tenantId: 'tenant-a', originalSaleId: 'sale-1', sequence: 1 });
  const replay = buildPosV2RevisionIdentifiers({ tenantId: 'tenant-a', originalSaleId: 'sale-1', sequence: 1 });
  const second = buildPosV2RevisionIdentifiers({ tenantId: 'tenant-a', originalSaleId: 'sale-1', sequence: 2 });

  assert.deepEqual(first, replay);
  assert.notEqual(first.revisionId, second.revisionId);
  assert.notEqual(first.replacementAttemptId, second.replacementAttemptId);
  assert.notEqual(first.replacementSaleId, second.replacementSaleId);
});

test('replacement IDs remain tenant-scoped and safe for Firestore document paths', () => {
  const identifiers = buildPosV2RevisionIdentifiers({
    tenantId: 'tenant / unsafe',
    originalSaleId: 'sale / unsafe',
    sequence: 3
  });

  for (const value of [
    identifiers.revisionId,
    identifiers.replacementAttemptId,
    identifiers.replacementSaleId,
    identifiers.replacementPaymentId,
    identifiers.replacementOutboxEventId
  ]) {
    assert.ok(value.length > 0);
    assert.ok(value.length <= 240);
    assert.doesNotMatch(value, /\//);
  }
});
