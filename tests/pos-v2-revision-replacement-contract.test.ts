import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPosV2RevisionIdentifiers } from '../src/services/pos-v2/posSaleRevisionV2Envelope';
import { validatePosCheckoutV2RevisionReplacementContract } from '../src/services/pos-v2/posCheckoutV2RevisionReplacement';

test('replacement checkout contract accepts the exact canonical revision identities', () => {
  const identifiers = buildPosV2RevisionIdentifiers({
    tenantId: 'tenant-a',
    originalSaleId: 'sale-original-1',
    sequence: 2
  });

  const validated = validatePosCheckoutV2RevisionReplacementContract({
    tenantId: 'tenant-a',
    attemptId: identifiers.replacementAttemptId,
    preparedSaleId: identifiers.replacementSaleId,
    preparedPaymentId: identifiers.replacementPaymentId,
    preparedOutboxEventId: identifiers.replacementOutboxEventId,
    context: {
      revisionId: identifiers.revisionId,
      revisionRequestId: 'revision-request-1',
      sequence: 2,
      originalSaleId: 'sale-original-1',
      originalReceiptNumber: 'MSK-2026-123456',
      replacementSaleId: identifiers.replacementSaleId,
      replacementPaymentId: identifiers.replacementPaymentId,
      replacementOutboxEventId: identifiers.replacementOutboxEventId
    }
  });

  assert.equal(validated?.revisionId, identifiers.revisionId);
  assert.equal(validated?.replacementSaleId, identifiers.replacementSaleId);
  assert.equal(validated?.sequence, 2);
});

test('ordinary checkout remains unchanged when no revision replacement context exists', () => {
  const validated = validatePosCheckoutV2RevisionReplacementContract({
    tenantId: 'tenant-a',
    attemptId: 'ordinary-attempt',
    preparedSaleId: 'ordinary-sale',
    preparedPaymentId: 'ordinary-payment',
    preparedOutboxEventId: 'ordinary-outbox'
  });

  assert.equal(validated, null);
});

test('replacement contract fails closed when any replacement identity drifts from canonical checkout', () => {
  const identifiers = buildPosV2RevisionIdentifiers({ tenantId: 'tenant-a', originalSaleId: 'sale-1', sequence: 1 });
  const base = {
    revisionId: identifiers.revisionId,
    revisionRequestId: 'request-1',
    sequence: 1,
    originalSaleId: 'sale-1',
    originalReceiptNumber: 'MSK-2026-111111',
    replacementSaleId: identifiers.replacementSaleId,
    replacementPaymentId: identifiers.replacementPaymentId,
    replacementOutboxEventId: identifiers.replacementOutboxEventId
  };

  assert.throws(() => validatePosCheckoutV2RevisionReplacementContract({
    tenantId: 'tenant-a',
    attemptId: identifiers.replacementAttemptId,
    preparedSaleId: identifiers.replacementSaleId,
    preparedPaymentId: identifiers.replacementPaymentId,
    preparedOutboxEventId: identifiers.replacementOutboxEventId,
    context: { ...base, replacementSaleId: `${identifiers.replacementSaleId}-drift` }
  }), /canonical POS V2 checkout identities/i);

  assert.throws(() => validatePosCheckoutV2RevisionReplacementContract({
    tenantId: 'tenant-a',
    attemptId: identifiers.replacementAttemptId,
    preparedSaleId: identifiers.replacementSaleId,
    preparedPaymentId: identifiers.replacementPaymentId,
    preparedOutboxEventId: identifiers.replacementOutboxEventId,
    context: { ...base, replacementPaymentId: `${identifiers.replacementPaymentId}-drift` }
  }), /canonical POS V2 checkout identities/i);
});

test('replacement contract rejects incomplete linkage, invalid sequence and original identity reuse', () => {
  const identifiers = buildPosV2RevisionIdentifiers({ tenantId: 'tenant-a', originalSaleId: 'sale-1', sequence: 1 });
  const valid = {
    revisionId: identifiers.revisionId,
    revisionRequestId: 'request-1',
    sequence: 1,
    originalSaleId: 'sale-1',
    originalReceiptNumber: 'MSK-2026-111111',
    replacementSaleId: identifiers.replacementSaleId,
    replacementPaymentId: identifiers.replacementPaymentId,
    replacementOutboxEventId: identifiers.replacementOutboxEventId
  };
  const params = {
    tenantId: 'tenant-a',
    attemptId: identifiers.replacementAttemptId,
    preparedSaleId: identifiers.replacementSaleId,
    preparedPaymentId: identifiers.replacementPaymentId,
    preparedOutboxEventId: identifiers.replacementOutboxEventId
  };

  assert.throws(() => validatePosCheckoutV2RevisionReplacementContract({ ...params, context: { ...valid, revisionRequestId: '' } }), /linkage is incomplete/i);
  assert.throws(() => validatePosCheckoutV2RevisionReplacementContract({ ...params, context: { ...valid, sequence: 0 } }), /positive whole number/i);
  assert.throws(() => validatePosCheckoutV2RevisionReplacementContract({ ...params, context: { ...valid, originalSaleId: identifiers.replacementSaleId } }), /cannot reuse the original sale identity/i);
});
