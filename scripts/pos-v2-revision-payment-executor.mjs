import {
  assertExistingPaymentReversalMatches,
  buildPaymentReversal
} from './pos-v2-revision-payment-core.mjs';

export async function executePaymentReversal({
  db,
  sale,
  payment,
  revisionId,
  requestedBy,
  requestedByName,
  reason,
  FieldValue
}) {
  if (!db || typeof db.runTransaction !== 'function') {
    throw new Error('Payment reversal requires a Firestore database.');
  }
  if (!FieldValue || typeof FieldValue.serverTimestamp !== 'function') {
    throw new Error('Payment reversal requires server timestamps.');
  }

  const expected = buildPaymentReversal({
    payment,
    sale,
    revisionId,
    requestedBy,
    requestedByName,
    reason
  });
  const ref = db.collection('pos_payment_reversals').doc(expected.reversalId);

  return db.runTransaction(async tx => {
    const existingSnap = await tx.get(ref);
    if (existingSnap.exists) {
      const existing = existingSnap.data();
      assertExistingPaymentReversalMatches({ existing, expected });
      return {
        replayed: true,
        reversalId: expected.reversalId,
        originalPaymentId: expected.originalPaymentId,
        amountDelta: expected.amountDelta,
        settledDelta: expected.settledDelta,
        outstandingDelta: expected.outstandingDelta
      };
    }

    const timestamp = FieldValue.serverTimestamp();
    tx.create(ref, {
      ...expected,
      status: 'COMPLETED',
      createdAt: timestamp,
      completedAt: timestamp
    });

    return {
      replayed: false,
      reversalId: expected.reversalId,
      originalPaymentId: expected.originalPaymentId,
      amountDelta: expected.amountDelta,
      settledDelta: expected.settledDelta,
      outstandingDelta: expected.outstandingDelta
    };
  });
}