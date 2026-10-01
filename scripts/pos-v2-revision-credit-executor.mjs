import {
  assertExistingInstitutionalCreditReversalMatches,
  buildInstitutionalCreditReversal,
  validateInstitutionalCreditOriginal
} from './pos-v2-revision-credit-core.mjs';

export async function executeInstitutionalCreditReversal({
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
    throw new Error('Institutional credit reversal requires a Firestore database.');
  }
  if (!FieldValue || typeof FieldValue.serverTimestamp !== 'function') {
    throw new Error('Institutional credit reversal requires server timestamps.');
  }

  const expected = buildInstitutionalCreditReversal({
    sale,
    payment,
    revisionId,
    requestedBy,
    requestedByName,
    reason
  });

  const reversalRef = db.collection('pos_credit_reversals').doc(expected.reversalId);
  const receivableRef = db.collection('credit_receivables').doc(expected.originalReceivableId);

  return db.runTransaction(async tx => {
    const [reversalSnap, receivableSnap] = await Promise.all([
      tx.get(reversalRef),
      tx.get(receivableRef)
    ]);

    if (reversalSnap.exists) {
      const existing = reversalSnap.data();
      assertExistingInstitutionalCreditReversalMatches({ existing, expected });
      if (!receivableSnap.exists) {
        throw new Error('Institutional credit reversal exists but original receivable is missing. Manual review required.');
      }
      const receivable = receivableSnap.data();
      if (receivable.reversalId !== expected.reversalId || receivable.status !== 'reversed' || Number(receivable.outstanding_ugx || 0) !== 0) {
        throw new Error('Institutional credit reversal history is partial or conflicting. Manual review required.');
      }
      return {
        replayed: true,
        reversalId: expected.reversalId,
        receivableId: expected.originalReceivableId,
        amountDelta: expected.amountDelta,
        outstandingDelta: expected.outstandingDelta
      };
    }

    if (!receivableSnap.exists) throw new Error('Original institutional credit receivable is missing.');
    const receivable = receivableSnap.data();
    if (receivable.reversalId || receivable.status === 'reversed') {
      throw new Error('Institutional credit receivable already contains reversal metadata without the canonical reversal record. Manual review required.');
    }

    validateInstitutionalCreditOriginal({
      sale,
      payment,
      receivable,
      expectedAmount: expected.amount
    });

    const timestamp = FieldValue.serverTimestamp();
    tx.create(reversalRef, {
      ...expected,
      priorStatus: receivable.status || 'outstanding',
      priorOutstandingAmount: Number(receivable.outstanding_ugx || 0),
      status: 'COMPLETED',
      createdAt: timestamp,
      completedAt: timestamp
    });

    tx.update(receivableRef, {
      outstanding_ugx: 0,
      status: 'reversed',
      reversalId: expected.reversalId,
      revisionId: expected.revisionId,
      reversedAmount: expected.amount,
      reversedBy: expected.requestedBy,
      reversedByName: expected.requestedByName,
      reversalReason: expected.reason,
      reversedAt: timestamp,
      updatedAt: timestamp
    });

    return {
      replayed: false,
      reversalId: expected.reversalId,
      receivableId: expected.originalReceivableId,
      amountDelta: expected.amountDelta,
      outstandingDelta: expected.outstandingDelta
    };
  });
}
