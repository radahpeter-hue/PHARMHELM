const REVERSAL_COMPLETE = 'REVERSAL_COMPLETE';
const REPLACEMENT_PENDING = 'REPLACEMENT_PENDING';

function clean(value) {
  return String(value ?? '').trim();
}

function allReversalConsumersComplete(consumers = {}) {
  const names = ['inventory', 'consumption', 'payment', 'welfare', 'institutionalCredit', 'quotation'];
  return names.every(name => {
    const status = clean(consumers?.[name]?.status).toUpperCase();
    return status === 'COMPLETED' || status === 'NOT_APPLICABLE';
  });
}

export async function closeoutRevisionReversal({ db, requestRef, FieldValue }) {
  if (!db || typeof db.runTransaction !== 'function') throw new Error('Revision lifecycle closeout requires Firestore.');
  if (!requestRef) throw new Error('Revision lifecycle closeout requires the revision request reference.');
  if (!FieldValue || typeof FieldValue.serverTimestamp !== 'function') throw new Error('Revision lifecycle closeout requires server timestamps.');

  return db.runTransaction(async tx => {
    const requestSnap = await tx.get(requestRef);
    if (!requestSnap.exists) throw new Error('Revision request disappeared before lifecycle closeout.');
    const request = requestSnap.data();

    const requestStatus = clean(request.status).toUpperCase();
    if (requestStatus === REPLACEMENT_PENDING) {
      return {
        replayed: true,
        replacementSaleId: clean(request.pendingReplacementSaleId || request.replacementSaleId),
        revisionId: clean(request.revisionId)
      };
    }

    if (requestStatus !== REVERSAL_COMPLETE) {
      throw new Error('Revision request is not fully reversed and cannot advance to replacement pending.');
    }
    if (!allReversalConsumersComplete(request.reversalConsumers || {})) {
      throw new Error('Not all revision reversal consumers are complete.');
    }

    const revisionId = clean(request.revisionId);
    const originalSaleId = clean(request.originalSaleId);
    const replacementSaleId = clean(request.pendingReplacementSaleId || request.replacementSaleId);
    if (!revisionId || !originalSaleId || !replacementSaleId) {
      throw new Error('Revision lifecycle closeout is missing revision, original sale, or replacement sale identity.');
    }

    const saleRef = db.collection('sales').doc(originalSaleId);
    const saleSnap = await tx.get(saleRef);
    if (!saleSnap.exists) throw new Error('Original POS V2 sale disappeared before lifecycle closeout.');
    const sale = saleSnap.data();

    if (Number(sale.engineVersion || 0) !== 2) throw new Error('Revision lifecycle closeout only supports POS V2 sales.');
    if (sale.status !== 'completed') throw new Error('Original POS V2 sale canonical status changed before lifecycle closeout. Manual review required.');
    if (sale.revisionLocked !== true || clean(sale.revisionId) !== revisionId) {
      throw new Error('Original POS V2 sale revision lock does not match this revision. Manual review required.');
    }
    if (clean(sale.revisionLifecycle) !== 'REVERSAL_PENDING') {
      throw new Error('Original POS V2 sale is not in the expected reversal-pending lifecycle.');
    }
    if (clean(sale.pendingReplacementSaleId) !== replacementSaleId) {
      throw new Error('Original POS V2 sale replacement identity does not match the revision request. Manual review required.');
    }
    if (clean(sale.supersededBySaleId)) {
      throw new Error('Original POS V2 sale is already superseded. Manual review required.');
    }

    const timestamp = FieldValue.serverTimestamp();
    tx.update(requestRef, {
      status: REPLACEMENT_PENDING,
      reversalState: REVERSAL_COMPLETE,
      reversalCompletedAt: request.reversalCompletedAt || timestamp,
      replacementLifecycle: REPLACEMENT_PENDING,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: null,
      updatedAt: timestamp
    });

    tx.update(saleRef, {
      revisionLifecycle: REPLACEMENT_PENDING,
      revisionReversalCompletedAt: sale.revisionReversalCompletedAt || timestamp,
      pendingReplacementSaleId: replacementSaleId,
      updatedAt: timestamp
    });

    return {
      replayed: false,
      replacementSaleId,
      revisionId
    };
  });
}

export { allReversalConsumersComplete };
