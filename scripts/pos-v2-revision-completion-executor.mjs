import { allReversalConsumersComplete } from './pos-v2-revision-lifecycle-executor.mjs';
import { assertRevisionCommercialEvidence } from './pos-v2-revision-commercial-evidence.mjs';

function clean(value) {
  return String(value ?? '').trim();
}

function assertCompletionChain({ request, originalSale, replacementSale, payment, outbox }) {
  const requestStatus = clean(request?.status);
  const replay = requestStatus === 'COMPLETED';
  if (!request || (requestStatus !== 'REPLACEMENT_CREATED' && !replay)) {
    throw new Error('Revision completion requires a REPLACEMENT_CREATED or COMPLETED request.');
  }

  const revisionId = clean(request.revisionId);
  const originalSaleId = clean(request.originalSaleId);
  const replacementSaleId = clean(request.replacementSaleId || request.pendingReplacementSaleId);
  const replacementPaymentId = clean(request.replacementPaymentId);
  const replacementOutboxEventId = clean(request.replacementOutboxEventId);

  if (!revisionId || !originalSaleId || !replacementSaleId || !replacementPaymentId || !replacementOutboxEventId) {
    throw new Error('Revision completion canonical identity is incomplete.');
  }
  if (clean(request.reversalState) !== 'REVERSAL_COMPLETE' || !allReversalConsumersComplete(request.reversalConsumers || {})) {
    throw new Error('Revision completion requires the original reversal to remain fully complete.');
  }

  if (!originalSale || clean(originalSale.id) !== originalSaleId || Number(originalSale.engineVersion || 0) !== 2 || clean(originalSale.status) !== 'completed') {
    throw new Error('Original POS V2 sale identity is invalid for revision completion.');
  }
  if (originalSale.revisionLocked !== true || clean(originalSale.revisionId) !== revisionId) {
    throw new Error('Original POS V2 sale revision lock does not match this revision.');
  }
  if (clean(originalSale.pendingReplacementSaleId) !== replacementSaleId || clean(originalSale.supersededBySaleId) !== replacementSaleId) {
    throw new Error('Original POS V2 sale replacement linkage is inconsistent.');
  }
  if (clean(originalSale.supersededByReceiptNumber) !== clean(replacementSale?.receiptNumber)) {
    throw new Error('Original POS V2 sale replacement receipt linkage is inconsistent.');
  }

  if (!replacementSale || clean(replacementSale.id) !== replacementSaleId || Number(replacementSale.engineVersion || 0) !== 2 || clean(replacementSale.status) !== 'completed') {
    throw new Error('Canonical replacement POS V2 sale is missing or invalid for revision completion.');
  }
  if (replacementSale.isRevisionReplacement !== true || clean(replacementSale.revisionId) !== revisionId || clean(replacementSale.revisionOfSaleId) !== originalSaleId) {
    throw new Error('Replacement POS V2 sale revision linkage mismatch at completion.');
  }
  if (clean(replacementSale.revisionRequestId) !== clean(request.requestId || request.id)) {
    throw new Error('Replacement POS V2 sale revision request linkage mismatch at completion.');
  }
  if (clean(replacementSale.tenantId) !== clean(originalSale.tenantId) || clean(replacementSale.branchId) !== clean(originalSale.branchId)) {
    throw new Error('Replacement POS V2 sale crossed tenant or branch boundary at completion.');
  }
  if (clean(replacementSale.canonicalPaymentId) !== replacementPaymentId || clean(replacementSale.transactionOutboxEventId) !== replacementOutboxEventId) {
    throw new Error('Replacement POS V2 sale canonical payment or outbox linkage mismatch at completion.');
  }

  if (!payment || clean(payment.paymentId) !== replacementPaymentId || clean(payment.saleId) !== replacementSaleId || Number(payment.engineVersion || 0) !== 2) {
    throw new Error('Canonical replacement POS V2 payment linkage mismatch at completion.');
  }
  if (payment.isRevisionReplacement !== true || clean(payment.revisionId) !== revisionId || clean(payment.revisionOfSaleId) !== originalSaleId) {
    throw new Error('Replacement POS V2 payment revision linkage mismatch at completion.');
  }

  if (!outbox || clean(outbox.eventId) !== replacementOutboxEventId || clean(outbox.saleId) !== replacementSaleId || clean(outbox.paymentId) !== replacementPaymentId || Number(outbox.engineVersion || 0) !== 2 || clean(outbox.eventType) !== 'POS_SALE_COMMITTED') {
    throw new Error('Canonical replacement POS V2 outbox linkage mismatch at completion.');
  }
  if (outbox.isRevisionReplacement !== true || clean(outbox.revisionId) !== revisionId || clean(outbox.revisionOfSaleId) !== originalSaleId) {
    throw new Error('Replacement POS V2 outbox revision linkage mismatch at completion.');
  }
  if (clean(outbox.status) !== 'PROCESSED') {
    throw new Error('Replacement POS V2 downstream posting is not fully processed yet.');
  }

  assertRevisionCommercialEvidence({ request, replacementSale, payment });

  if (replay) {
    if (clean(request.replacementLifecycle) !== 'COMPLETED' || clean(originalSale.revisionLifecycle) !== 'COMPLETED') {
      throw new Error('Completed revision lifecycle is inconsistent.');
    }
    return 'REPLAY';
  }

  if (clean(request.replacementLifecycle) !== 'REPLACEMENT_CREATED' || clean(originalSale.revisionLifecycle) !== 'REPLACEMENT_CREATED') {
    throw new Error('Revision replacement linkage is not ready for completion.');
  }

  return 'READY';
}

export async function completeRevisionLifecycle({ db, requestRef, FieldValue }) {
  if (!db || typeof db.runTransaction !== 'function') throw new Error('Revision completion requires a Firestore database.');
  if (!requestRef || !FieldValue || typeof FieldValue.serverTimestamp !== 'function') {
    throw new Error('Revision completion requires a request reference and server timestamps.');
  }

  return db.runTransaction(async tx => {
    const requestSnap = await tx.get(requestRef);
    if (!requestSnap.exists) throw new Error('Revision request no longer exists at completion.');
    const request = { id: requestSnap.id, ...requestSnap.data() };

    const originalSaleId = clean(request.originalSaleId);
    const replacementSaleId = clean(request.replacementSaleId || request.pendingReplacementSaleId);
    const replacementPaymentId = clean(request.replacementPaymentId);
    const replacementOutboxEventId = clean(request.replacementOutboxEventId);
    if (!originalSaleId || !replacementSaleId || !replacementPaymentId || !replacementOutboxEventId) {
      throw new Error('Revision completion canonical identity is incomplete.');
    }

    const originalRef = db.collection('sales').doc(originalSaleId);
    const replacementRef = db.collection('sales').doc(replacementSaleId);
    const paymentRef = db.collection('pos_payments').doc(replacementPaymentId);
    const outboxRef = db.collection('pos_transaction_outbox').doc(replacementOutboxEventId);
    const [originalSnap, replacementSnap, paymentSnap, outboxSnap] = await Promise.all([
      tx.get(originalRef),
      tx.get(replacementRef),
      tx.get(paymentRef),
      tx.get(outboxRef)
    ]);

    const originalSale = originalSnap.exists ? { id: originalSnap.id, ...originalSnap.data() } : null;
    const replacementSale = replacementSnap.exists ? { id: replacementSnap.id, ...replacementSnap.data() } : null;
    const payment = paymentSnap.exists ? { id: paymentSnap.id, ...paymentSnap.data() } : null;
    const outbox = outboxSnap.exists ? { id: outboxSnap.id, ...outboxSnap.data() } : null;

    const chainState = assertCompletionChain({ request, originalSale, replacementSale, payment, outbox });
    if (chainState === 'REPLAY') {
      return {
        replayed: true,
        revisionId: clean(request.revisionId),
        originalSaleId,
        replacementSaleId,
        replacementReceiptNumber: clean(replacementSale.receiptNumber)
      };
    }

    const timestamp = FieldValue.serverTimestamp();
    tx.update(originalRef, {
      revisionLifecycle: 'COMPLETED',
      revisionCompletedAt: timestamp,
      updatedAt: timestamp
    });

    tx.update(requestRef, {
      status: 'COMPLETED',
      replacementLifecycle: 'COMPLETED',
      revisionCompletedAt: timestamp,
      completedAt: timestamp,
      lastError: null,
      updatedAt: timestamp
    });

    return {
      replayed: false,
      revisionId: clean(request.revisionId),
      originalSaleId,
      replacementSaleId,
      replacementReceiptNumber: clean(replacementSale.receiptNumber)
    };
  });
}

export { assertCompletionChain };
