import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertReplacementChain } from '../scripts/pos-v2-revision-replacement-finalizer.mjs';

function fixture() {
  const revisionId = 'revision-1';
  const requestId = 'request-1';
  const originalSaleId = 'sale-original';
  const replacementSaleId = 'sale-replacement';
  const replacementPaymentId = 'pos_payment_sale-replacement';
  const replacementOutboxEventId = 'pos_outbox_sale-replacement';

  return {
    request: {
      id: requestId,
      requestId,
      status: 'REPLACEMENT_PENDING',
      revisionId,
      originalSaleId,
      pendingReplacementSaleId: replacementSaleId,
      replacementSaleId,
      replacementPaymentId,
      replacementOutboxEventId
    },
    originalSale: {
      id: originalSaleId,
      tenantId: 'tenant-a',
      branchId: 'branch-a',
      receiptNumber: 'MSK-2026-111111',
      engineVersion: 2,
      status: 'completed',
      revisionLocked: true,
      revisionId,
      revisionLifecycle: 'REPLACEMENT_PENDING',
      pendingReplacementSaleId: replacementSaleId
    },
    replacementSale: {
      id: replacementSaleId,
      tenantId: 'tenant-a',
      branchId: 'branch-a',
      receiptNumber: 'MSK-2026-222222',
      engineVersion: 2,
      status: 'completed',
      isRevisionReplacement: true,
      revisionId,
      revisionRequestId: requestId,
      revisionOfSaleId: originalSaleId,
      originalReceiptNumber: 'MSK-2026-111111',
      canonicalPaymentId: replacementPaymentId,
      transactionOutboxEventId: replacementOutboxEventId
    },
    payment: {
      paymentId: replacementPaymentId,
      saleId: replacementSaleId,
      engineVersion: 2,
      isRevisionReplacement: true,
      revisionId,
      revisionOfSaleId: originalSaleId
    },
    outbox: {
      eventId: replacementOutboxEventId,
      eventType: 'POS_SALE_COMMITTED',
      saleId: replacementSaleId,
      paymentId: replacementPaymentId,
      engineVersion: 2,
      isRevisionReplacement: true,
      revisionId,
      revisionOfSaleId: originalSaleId
    }
  } as any;
}

function completedFixture() {
  const base = fixture();
  return {
    ...base,
    request: {
      ...base.request,
      status: 'REPLACEMENT_CREATED',
      replacementLifecycle: 'REPLACEMENT_CREATED',
      replacementReceiptNumber: base.replacementSale.receiptNumber
    },
    originalSale: {
      ...base.originalSale,
      revisionLifecycle: 'REPLACEMENT_CREATED',
      supersededBySaleId: base.replacementSale.id,
      supersededByReceiptNumber: base.replacementSale.receiptNumber
    }
  } as any;
}

test('replacement finalizer accepts only a complete canonical replacement chain', () => {
  assert.equal(assertReplacementChain(fixture()), 'READY');
});

test('replacement finalizer rejects identity, tenant and canonical-link drift', () => {
  const base = fixture();
  assert.throws(() => assertReplacementChain({ ...base, replacementSale: { ...base.replacementSale, revisionId: 'other-revision' } }), /revision linkage mismatch/i);
  assert.throws(() => assertReplacementChain({ ...base, replacementSale: { ...base.replacementSale, branchId: 'branch-b' } }), /tenant or branch boundary/i);
  assert.throws(() => assertReplacementChain({ ...base, payment: { ...base.payment, saleId: 'other-sale' } }), /payment linkage mismatch/i);
  assert.throws(() => assertReplacementChain({ ...base, outbox: { ...base.outbox, eventType: 'OTHER_EVENT' } }), /outbox linkage mismatch/i);
});

test('replacement finalizer refuses premature or conflicting supersession', () => {
  const base = fixture();
  assert.throws(() => assertReplacementChain({ ...base, request: { ...base.request, status: 'PROCESSING' } }), /REPLACEMENT_PENDING or REPLACEMENT_CREATED/i);
  assert.throws(() => assertReplacementChain({ ...base, originalSale: { ...base.originalSale, revisionLifecycle: 'REVERSAL_PENDING' } }), /not awaiting its replacement/i);
  assert.throws(() => assertReplacementChain({ ...base, originalSale: { ...base.originalSale, supersededBySaleId: 'different-sale' } }), /already superseded/i);
});

test('completed linkage replay is accepted only after revalidating the entire canonical chain', () => {
  assert.equal(assertReplacementChain(completedFixture()), 'REPLAY');

  const base = completedFixture();
  assert.throws(() => assertReplacementChain({
    ...base,
    originalSale: { ...base.originalSale, supersededBySaleId: 'other-sale' }
  }), /supersession does not match/i);

  assert.throws(() => assertReplacementChain({
    ...base,
    request: { ...base.request, replacementLifecycle: 'REPLACEMENT_PENDING' }
  }), /replacement lifecycle is inconsistent/i);

  assert.throws(() => assertReplacementChain({
    ...base,
    payment: { ...base.payment, revisionId: 'other-revision' }
  }), /payment revision linkage mismatch/i);
});

test('crash after replacement checkout but before linkage remains recoverable from REPLACEMENT_PENDING', () => {
  const base = fixture();
  assert.equal(base.request.status, 'REPLACEMENT_PENDING');
  assert.equal(base.originalSale.revisionLifecycle, 'REPLACEMENT_PENDING');
  assert.equal(base.originalSale.supersededBySaleId, undefined);
  assert.equal(assertReplacementChain(base), 'READY');
});

test('replacement finalizer preserves canonical completed sale statuses and uses linkage lifecycle instead', () => {
  const source = readFileSync('scripts/pos-v2-revision-replacement-finalizer.mjs', 'utf8');
  assert.match(source, /supersededBySaleId: replacementSaleId/);
  assert.match(source, /revisionLifecycle: 'REPLACEMENT_CREATED'/);
  assert.match(source, /status: 'REPLACEMENT_CREATED'/);
  assert.doesNotMatch(source, /status:\s*'revised'/i);
  assert.doesNotMatch(source, /status:\s*'voided'/i);
  assert.doesNotMatch(source, /\.delete\(|tx\.delete\(/);
});

test('replacement finalizer links original and request atomically without mutating canonical replacement payment or outbox', () => {
  const source = readFileSync('scripts/pos-v2-revision-replacement-finalizer.mjs', 'utf8');
  assert.match(source, /db\.runTransaction/);
  assert.match(source, /tx\.update\(originalRef/);
  assert.match(source, /tx\.update\(requestRef/);
  assert.doesNotMatch(source, /tx\.update\(paymentRef/);
  assert.doesNotMatch(source, /tx\.update\(outboxRef/);
  assert.doesNotMatch(source, /tx\.update\(replacementRef/);
});

test('replay path re-reads original sale, replacement sale, payment and outbox before returning success', () => {
  const source = readFileSync('scripts/pos-v2-revision-replacement-finalizer.mjs', 'utf8');
  const readIndex = source.indexOf('Promise.all([');
  const assertIndex = source.indexOf('assertReplacementChain({ request, originalSale, replacementSale, payment, outbox })');
  const replayIndex = source.indexOf("if (chainState === 'REPLAY')");
  assert.ok(readIndex >= 0 && readIndex < assertIndex && assertIndex < replayIndex);
});
