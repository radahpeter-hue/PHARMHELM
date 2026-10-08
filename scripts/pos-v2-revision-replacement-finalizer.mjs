import { assertRevisionCommercialEvidence } from './pos-v2-revision-commercial-evidence.mjs';

function clean(value) {
  return String(value ?? '').trim();
}

function assertReplacementChain({ request, originalSale, replacementSale, payment, outbox }) {
  const requestStatus = clean(request?.status);
  const replay = requestStatus === 'REPLACEMENT_CREATED';
  if (!request || (requestStatus !== 'REPLACEMENT_PENDING' && !replay)) {
    throw new Error('Revision replacement finalization requires a REPLACEMENT_PENDING or REPLACEMENT_CREATED request.');
  }

  const revisionId = clean(request.revisionId);
  const originalSaleId = clean(request.originalSaleId);
  const replacementSaleId = clean(request.pendingReplacementSaleId || request.replacementSaleId);
  const replacementPaymentId = clean(request.replacementPaymentId);
  const replacementOutboxEventId = clean(request.replacementOutboxEventId);

  if (!revisionId || !originalSaleId || !replacementSaleId || !replacementPaymentId || !replacementOutboxEventId) {
    throw new Error('Revision replacement canonical identity is incomplete.');
  }

  if (!originalSale || clean(originalSale.id) !== originalSaleId || Number(originalSale.engineVersion || 0) !== 2 || clean(originalSale.status) !== 'completed') {
    throw new Error('Original POS V2 sale identity is invalid for replacement finalization.');
  }
  if (originalSale.revisionLocked !== true || clean(originalSale.revisionId) !== revisionId) {
    throw new Error('Original POS V2 sale revision lock does not belong to this revision.');
  }
  if (clean(originalSale.pendingReplacementSaleId) !== replacementSaleId) {
    throw new Error('Original POS V2 sale pending replacement identity mismatch.');
  }

  if (replay) {
    if (clean(request.replacementLifecycle) !== 'REPLACEMENT_CREATED') {
      throw new Error('Completed revision request replacement lifecycle is inconsistent.');
    }
    if (clean(originalSale.revisionLifecycle) !== 'REPLACEMENT_CREATED') {
      throw new Error('Completed original POS V2 sale replacement lifecycle is inconsistent.');
    }
    if (clean(originalSale.supersededBySaleId) !== replacementSaleId) {
      throw new Error('Completed original POS V2 sale supersession does not match the canonical replacement.');
    }
    if (clean(request.replacementSaleId) !== replacementSaleId || clean(request.replacementReceiptNumber) !== clean(replacementSale?.receiptNumber)) {
      throw new Error('Completed revision request replacement identity is inconsistent.');
    }
  } else {
    if (clean(originalSale.revisionLifecycle) !== 'REPLACEMENT_PENDING') {
      throw new Error('Original POS V2 sale is not awaiting its replacement.');
    }
    if (clean(originalSale.supersededBySaleId)) {
      throw new Error('Original POS V2 sale is already superseded by a different transaction.');
    }
  }

  if (!replacementSale || clean(replacementSale.id) !== replacementSaleId || Number(replacementSale.engineVersion || 0) !== 2 || clean(replacementSale.status) !== 'completed') {
    throw new Error('Canonical replacement POS V2 sale is missing or invalid.');
  }
  if (replacementSale.isRevisionReplacement !== true || clean(replacementSale.revisionId) !== revisionId || clean(replacementSale.revisionOfSaleId) !== originalSaleId) {
    throw new Error('Replacement POS V2 sale revision linkage mismatch.');
  }
  if (clean(replacementSale.revisionRequestId) !== clean(request.requestId || request.id)) {
    throw new Error('Replacement POS V2 sale revision request linkage mismatch.');
  }
  if (clean(replacementSale.originalReceiptNumber) !== clean(originalSale.receiptNumber)) {
    throw new Error('Replacement POS V2 sale original receipt linkage mismatch.');
  }
  if (clean(replacementSale.tenantId) !== clean(originalSale.tenantId) || clean(replacementSale.branchId) !== clean(originalSale.branchId)) {
    throw new Error('Replacement POS V2 sale crossed the original tenant or branch boundary.');
  }
  if (clean(replacementSale.canonicalPaymentId) !== replacementPaymentId || clean(replacementSale.transactionOutboxEventId) !== replacementOutboxEventId) {
    throw new Error('Replacement POS V2 sale canonical payment or outbox linkage mismatch.');
  }

  if (!payment || clean(payment.paymentId) !== replacementPaymentId || clean(payment.saleId) !== replacementSaleId || Number(payment.engineVersion || 0) !== 2) {
    throw new Error('Canonical replacement POS V2 payment linkage mismatch.');
  }
  if (payment.isRevisionReplacement !== true || clean(payment.revisionId) !== revisionId || clean(payment.revisionOfSaleId) !== originalSaleId) {
    throw new Error('Replacement POS V2 payment revision linkage mismatch.');
  }

  if (!outbox || clean(outbox.eventId) !== replacementOutboxEventId || clean(outbox.saleId) !== replacementSaleId || clean(outbox.paymentId) !== replacementPaymentId || Number(outbox.engineVersion || 0) !== 2 || clean(outbox.eventType) !== 'POS_SALE_COMMITTED') {
    throw new Error('Canonical replacement POS V2 outbox linkage mismatch.');
  }
  if (outbox.isRevisionReplacement !== true || clean(outbox.revisionId) !== revisionId || clean(outbox.revisionOfSaleId) !== originalSaleId) {
    throw new Error('Replacement POS V2 outbox revision linkage mismatch.');
  }

  assertRevisionCommercialEvidence({ request, replacementSale, payment });
  return replay ? 'REPLAY' : 'READY';
}

export async function finalizeRevisionReplacementLinkage({ db, requestRef, FieldValue }) {
  if (!db || typeof db.runTransaction !== 'function') throw new Error('Revision replacement finalization requires a Firestore database.');
  if (!requestRef || !FieldValue || typeof FieldValue.serverTimestamp !== 'function') throw new Error('Revision replacement finalization requires a request reference and server timestamps.');

  return db.runTransaction(async tx => {
    const requestSnap = await tx.get(requestRef);
    if (!requestSnap.exists) throw new Error('Revision request no longer exists.');
    const request = { id: requestSnap.id, ...requestSnap.data() };

    const originalSaleId = clean(request.originalSaleId);
    const replacementSaleId = clean(request.pendingReplacementSaleId || request.replacementSaleId);
    const replacementPaymentId = clean(request.replacementPaymentId);
    const replacementOutboxEventId = clean(request.replacementOutboxEventId);
    if (!originalSaleId || !replacementSaleId || !replacementPaymentId || !replacementOutboxEventId) {
      throw new Error('Revision replacement canonical identity is incomplete.');
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

    const chainState = assertReplacementChain({ request, originalSale, replacementSale, payment, outbox });
    if (chainState === 'REPLAY') {
      return {
        replayed: true,
        originalSaleId,
        replacementSaleId,
        replacementReceiptNumber: clean(replacementSale.receiptNumber),
        replacementPaymentId,
        replacementOutboxEventId
      };
    }

    const timestamp = FieldValue.serverTimestamp();
    tx.update(originalRef, {
      supersededBySaleId: replacementSaleId,
      supersededByReceiptNumber: replacementSale.receiptNumber,
      revisionLifecycle: 'REPLACEMENT_CREATED',
      replacementCreatedAt: timestamp,
      updatedAt: timestamp
    });

    tx.update(requestRef, {
      status: 'REPLACEMENT_CREATED',
      replacementLifecycle: 'REPLACEMENT_CREATED',
      replacementSaleId,
      replacementReceiptNumber: replacementSale.receiptNumber,
      replacementPaymentId,
      replacementOutboxEventId,
      replacementCreatedAt: timestamp,
      lastError: null,
      updatedAt: timestamp
    });

    return {
      replayed: false,
      originalSaleId,
      replacementSaleId,
      replacementReceiptNumber: replacementSale.receiptNumber,
      replacementPaymentId,
      replacementOutboxEventId
    };
  });
}

export { assertReplacementChain };
