import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertCompletionChain } from '../scripts/pos-v2-revision-completion-executor.mjs';

function reversalConsumers() {
  return {
    inventory: { status: 'COMPLETED' },
    consumption: { status: 'COMPLETED' },
    payment: { status: 'COMPLETED' },
    welfare: { status: 'NOT_APPLICABLE' },
    institutionalCredit: { status: 'NOT_APPLICABLE' },
    quotation: { status: 'NOT_APPLICABLE' }
  };
}

function fixture() {
  const revisionId = 'revision-1';
  const requestId = 'request-1';
  const originalSaleId = 'sale-original';
  const replacementSaleId = 'sale-replacement';
  const paymentId = 'pos_payment_sale-replacement';
  const outboxId = 'pos_outbox_sale-replacement';
  const receipt = 'MSK-2026-222222';

  return {
    request: {
      id: requestId,
      requestId,
      status: 'REPLACEMENT_CREATED',
      replacementLifecycle: 'REPLACEMENT_CREATED',
      reversalState: 'REVERSAL_COMPLETE',
      reversalConsumers: reversalConsumers(),
      revisionId,
      originalSaleId,
      pendingReplacementSaleId: replacementSaleId,
      replacementSaleId,
      replacementPaymentId: paymentId,
      replacementOutboxEventId: outboxId,
      replacementReceiptNumber: receipt
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
      revisionLifecycle: 'REPLACEMENT_CREATED',
      pendingReplacementSaleId: replacementSaleId,
      supersededBySaleId: replacementSaleId,
      supersededByReceiptNumber: receipt
    },
    replacementSale: {
      id: replacementSaleId,
      tenantId: 'tenant-a',
      branchId: 'branch-a',
      receiptNumber: receipt,
      engineVersion: 2,
      status: 'completed',
      isRevisionReplacement: true,
      revisionId,
      revisionRequestId: requestId,
      revisionOfSaleId: originalSaleId,
      canonicalPaymentId: paymentId,
      transactionOutboxEventId: outboxId
    },
    payment: {
      paymentId,
      saleId: replacementSaleId,
      engineVersion: 2,
      isRevisionReplacement: true,
      revisionId,
      revisionOfSaleId: originalSaleId
    },
    outbox: {
      eventId: outboxId,
      eventType: 'POS_SALE_COMMITTED',
      status: 'PROCESSED',
      saleId: replacementSaleId,
      paymentId,
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
    request: { ...base.request, status: 'COMPLETED', replacementLifecycle: 'COMPLETED' },
    originalSale: { ...base.originalSale, revisionLifecycle: 'COMPLETED' }
  } as any;
}

test('revision completes only after the replacement downstream outbox is processed', () => {
  assert.equal(assertCompletionChain(fixture()), 'READY');
  const base = fixture();
  assert.throws(() => assertCompletionChain({
    ...base,
    outbox: { ...base.outbox, status: 'PROCESSING' }
  }), /downstream posting is not fully processed/i);
});

test('revision completion requires the original reversal to remain fully complete', () => {
  const base = fixture();
  assert.throws(() => assertCompletionChain({
    ...base,
    request: { ...base.request, reversalState: 'REVERSAL_PENDING' }
  }), /original reversal to remain fully complete/i);
  assert.throws(() => assertCompletionChain({
    ...base,
    request: {
      ...base.request,
      reversalConsumers: { ...base.request.reversalConsumers, payment: { status: 'FAILED' } }
    }
  }), /original reversal to remain fully complete/i);
});

test('revision completion fails closed on original replacement or canonical identity drift', () => {
  const base = fixture();
  assert.throws(() => assertCompletionChain({
    ...base,
    originalSale: { ...base.originalSale, supersededBySaleId: 'other-sale' }
  }), /replacement linkage is inconsistent/i);
  assert.throws(() => assertCompletionChain({
    ...base,
    replacementSale: { ...base.replacementSale, branchId: 'branch-b' }
  }), /tenant or branch boundary/i);
  assert.throws(() => assertCompletionChain({
    ...base,
    payment: { ...base.payment, revisionId: 'other-revision' }
  }), /payment revision linkage mismatch/i);
});

test('completed revision replay revalidates the same durable chain', () => {
  assert.equal(assertCompletionChain(completedFixture()), 'REPLAY');
  const base = completedFixture();
  assert.throws(() => assertCompletionChain({
    ...base,
    originalSale: { ...base.originalSale, revisionLifecycle: 'REPLACEMENT_CREATED' }
  }), /completed revision lifecycle is inconsistent/i);
});

test('completion changes lifecycle metadata only and preserves immutable transaction records', () => {
  const source = readFileSync('scripts/pos-v2-revision-completion-executor.mjs', 'utf8');
  assert.match(source, /status: 'COMPLETED'/);
  assert.match(source, /replacementLifecycle: 'COMPLETED'/);
  assert.match(source, /revisionLifecycle: 'COMPLETED'/);
  assert.doesNotMatch(source, /status:\s*'revised'/i);
  assert.doesNotMatch(source, /status:\s*'voided'/i);
  assert.doesNotMatch(source, /tx\.update\(replacementRef/);
  assert.doesNotMatch(source, /tx\.update\(paymentRef/);
  assert.doesNotMatch(source, /tx\.update\(outboxRef/);
  assert.doesNotMatch(source, /\.delete\(|tx\.delete\(/);
});

test('completion leaves the original sale revision lock intact permanently', () => {
  const source = readFileSync('scripts/pos-v2-revision-completion-executor.mjs', 'utf8');
  assert.match(source, /originalSale\.revisionLocked !== true/);
  assert.doesNotMatch(source, /revisionLocked:\s*false/);
});
