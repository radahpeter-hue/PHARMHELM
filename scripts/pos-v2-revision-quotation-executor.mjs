import {
  assertExistingQuotationReversalMatches,
  buildQuotationReversal,
  quotationReversalId,
  validateQuotationOriginal
} from './pos-v2-revision-quotation-core.mjs';

function clean(value) {
  return String(value ?? '').trim();
}

function normalizedReason(value) {
  return clean(value).replace(/\s+/g, ' ');
}

export async function executeQuotationReversal({
  db,
  sale,
  revisionId,
  requestedBy,
  requestedByName,
  reason,
  FieldValue
}) {
  if (!db || typeof db.runTransaction !== 'function') throw new Error('Quotation reversal requires a Firestore database.');
  if (!FieldValue || typeof FieldValue.serverTimestamp !== 'function') throw new Error('Quotation reversal requires server timestamps.');

  const quotationId = clean(sale?.sourceQuotationId);
  if (!quotationId) return { skipped: true, reason: 'NOT_APPLICABLE' };
  const deterministicReversalId = quotationReversalId({ revisionId, quotationId });

  const quotationRef = db.collection('pos_quotations').doc(quotationId);
  const saleRef = db.collection('sales').doc(sale.id);
  const reversalRef = db.collection('pos_quotation_reversals').doc(deterministicReversalId);

  return db.runTransaction(async tx => {
    const [quotationSnap, saleSnap, reversalSnap] = await Promise.all([
      tx.get(quotationRef),
      tx.get(saleRef),
      tx.get(reversalRef)
    ]);
    if (!quotationSnap.exists) throw new Error('Original source quotation is missing.');
    if (!saleSnap.exists) throw new Error('Original POS V2 sale is missing during quotation reversal.');

    const liveQuotation = quotationSnap.data();
    const liveSale = { id: saleSnap.id, ...saleSnap.data() };
    if (Number(liveSale.engineVersion || 0) !== 2) throw new Error('Quotation reversal only supports POS V2 sales.');
    if (clean(liveSale.sourceQuotationId) !== quotationId) throw new Error('Sale source quotation changed before reversal. Manual review required.');

    if (reversalSnap.exists) {
      const existing = reversalSnap.data();
      assertExistingQuotationReversalMatches({
        existing,
        expected: {
          reversalId: deterministicReversalId,
          revisionId: clean(revisionId),
          tenantId: clean(liveSale.tenantId),
          branchId: clean(liveSale.branchId),
          saleId: liveSale.id,
          quotationId,
          requestedBy: clean(requestedBy),
          reason: normalizedReason(reason),
          priorStatus: 'Converted',
          restoredStatus: 'Draft'
        }
      });
      if (
        liveQuotation.status !== 'Draft'
        || liveQuotation.convertedReceiptId !== null
        || liveQuotation.convertedAt !== null
        || liveQuotation.convertedValue !== null
        || liveQuotation.quotationReversalId !== deterministicReversalId
        || liveSale.quotationConversionStatus !== 'reversed'
        || liveSale.quotationConversionReversalId !== deterministicReversalId
      ) {
        throw new Error('Quotation reversal history is partial or conflicting. Manual review required.');
      }
      return {
        replayed: true,
        reversalId: deterministicReversalId,
        quotationId,
        restoredStatus: 'Draft'
      };
    }

    if (liveQuotation.quotationReversalId || liveQuotation.status === 'Draft') {
      throw new Error('Quotation contains reversal state without the canonical reversal record. Manual review required.');
    }

    validateQuotationOriginal({ sale: liveSale, quotation: liveQuotation });
    const expected = buildQuotationReversal({
      sale: liveSale,
      quotation: liveQuotation,
      revisionId,
      requestedBy,
      requestedByName,
      reason
    });
    const timestamp = FieldValue.serverTimestamp();

    tx.create(reversalRef, {
      ...expected,
      status: 'COMPLETED',
      createdAt: timestamp,
      completedAt: timestamp
    });

    tx.update(quotationRef, {
      status: 'Draft',
      convertedReceiptId: null,
      convertedAt: null,
      convertedValue: null,
      quotationReversalId: expected.reversalId,
      quotationRevisionId: expected.revisionId,
      conversionReversedBy: expected.requestedBy,
      conversionReversedByName: expected.requestedByName,
      conversionReversalReason: expected.reason,
      conversionReversedAt: timestamp,
      updatedAt: timestamp
    });

    tx.update(saleRef, {
      quotationConversionStatus: 'reversed',
      quotationConversionReversalId: expected.reversalId,
      quotationConversionReversedAt: timestamp,
      updatedAt: timestamp
    });

    return {
      replayed: false,
      reversalId: expected.reversalId,
      quotationId,
      restoredStatus: expected.restoredStatus
    };
  });
}
