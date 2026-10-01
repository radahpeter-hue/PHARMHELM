import {
  assertExistingQuotationReversalMatches,
  buildQuotationReversal,
  validateQuotationOriginal
} from './pos-v2-revision-quotation-core.mjs';

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

  const quotationId = String(sale?.sourceQuotationId || '').trim();
  if (!quotationId) return { skipped: true, reason: 'NOT_APPLICABLE' };

  const quotationRef = db.collection('pos_quotations').doc(quotationId);
  const saleRef = db.collection('sales').doc(sale.id);

  return db.runTransaction(async tx => {
    const [quotationSnap, saleSnap] = await Promise.all([tx.get(quotationRef), tx.get(saleRef)]);
    if (!quotationSnap.exists) throw new Error('Original source quotation is missing.');
    if (!saleSnap.exists) throw new Error('Original POS V2 sale is missing during quotation reversal.');

    const liveQuotation = quotationSnap.data();
    const liveSale = { id: saleSnap.id, ...saleSnap.data() };
    if (Number(liveSale.engineVersion || 0) !== 2) throw new Error('Quotation reversal only supports POS V2 sales.');
    if (String(liveSale.sourceQuotationId || '').trim() !== quotationId) throw new Error('Sale source quotation changed before reversal. Manual review required.');

    const expected = buildQuotationReversal({
      sale: liveSale,
      quotation: liveQuotation,
      revisionId,
      requestedBy,
      requestedByName,
      reason
    });
    const reversalRef = db.collection('pos_quotation_reversals').doc(expected.reversalId);
    const reversalSnap = await tx.get(reversalRef);

    if (reversalSnap.exists) {
      const existing = reversalSnap.data();
      assertExistingQuotationReversalMatches({ existing, expected });
      if (
        liveQuotation.status !== 'Draft'
        || liveQuotation.convertedReceiptId !== null
        || liveQuotation.convertedAt !== null
        || liveQuotation.convertedValue !== null
        || liveQuotation.quotationReversalId !== expected.reversalId
        || liveSale.quotationConversionStatus !== 'reversed'
        || liveSale.quotationConversionReversalId !== expected.reversalId
      ) {
        throw new Error('Quotation reversal history is partial or conflicting. Manual review required.');
      }
      return {
        replayed: true,
        reversalId: expected.reversalId,
        quotationId,
        restoredStatus: expected.restoredStatus
      };
    }

    if (liveQuotation.quotationReversalId || liveQuotation.status === 'Draft') {
      throw new Error('Quotation contains reversal state without the canonical reversal record. Manual review required.');
    }

    validateQuotationOriginal({ sale: liveSale, quotation: liveQuotation });
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
