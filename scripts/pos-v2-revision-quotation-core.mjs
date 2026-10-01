function clean(value) {
  return String(value ?? '').trim();
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safePart(value) {
  const normalized = clean(value).replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!normalized) throw new Error('Quotation reversal identity contains an empty identifier.');
  return normalized.slice(0, 160);
}

function normalizedReason(value) {
  return clean(value).replace(/\s+/g, ' ');
}

export function quotationReversalId({ revisionId, quotationId }) {
  return `pos_quotation_reversal_${safePart(revisionId)}_${safePart(quotationId)}`;
}

export function buildQuotationReversal({ sale, quotation, revisionId, requestedBy, requestedByName, reason }) {
  const saleId = clean(sale?.id);
  const tenantId = clean(sale?.tenantId);
  const branchId = clean(sale?.branchId);
  const quotationId = clean(sale?.sourceQuotationId);
  const actorId = clean(requestedBy);
  const actorName = clean(requestedByName);
  const revision = clean(revisionId);
  const normalized = normalizedReason(reason);

  if (Number(sale?.engineVersion || 0) !== 2) throw new Error('Quotation reversal only supports POS V2 sales.');
  if (!saleId || !tenantId || !branchId || !quotationId || !revision) throw new Error('Quotation reversal is missing canonical sale identity.');
  if (!actorId || !actorName) throw new Error('Quotation reversal requires a durable actor.');
  if (normalized.length < 8) throw new Error('Quotation reversal requires the approved revision reason.');

  validateQuotationOriginal({ sale, quotation });

  const convertedValue = numberValue(quotation?.convertedValue, NaN);
  return {
    reversalId: quotationReversalId({ revisionId: revision, quotationId }),
    revisionId: revision,
    tenantId,
    branchId,
    saleId,
    receiptNumber: clean(sale?.receiptNumber) || null,
    quotationId,
    source: 'POS_V2_REVISION',
    engineVersion: 2,
    priorStatus: 'Converted',
    restoredStatus: 'Draft',
    priorConvertedReceiptId: saleId,
    priorConvertedAt: quotation?.convertedAt || null,
    priorConvertedValue: convertedValue,
    requestedBy: actorId,
    requestedByName: actorName,
    reason: normalized
  };
}

export function validateQuotationOriginal({ sale, quotation }) {
  const saleId = clean(sale?.id);
  const quotationId = clean(sale?.sourceQuotationId);
  if (!quotation || typeof quotation !== 'object') throw new Error('Original source quotation is missing.');
  if (!quotationId) throw new Error('The POS V2 sale has no source quotation.');
  if (clean(quotation?.tenantId) !== clean(sale?.tenantId)) throw new Error('Quotation tenant mismatch.');
  if (quotation?.branchId && clean(quotation.branchId) !== clean(sale?.branchId)) throw new Error('Quotation branch mismatch.');
  if (clean(quotation?.status) !== 'Converted') throw new Error('Source quotation is not in the canonical Converted state.');
  if (clean(quotation?.convertedReceiptId) !== saleId) throw new Error('Source quotation is not linked to the original POS V2 sale.');

  const saleTotal = numberValue(sale?.totalAmount ?? sale?.total, NaN);
  const convertedValue = numberValue(quotation?.convertedValue, NaN);
  if (!Number.isFinite(saleTotal) || saleTotal < 0) throw new Error('Original POS V2 sale total is invalid.');
  if (!Number.isFinite(convertedValue) || Math.abs(convertedValue - saleTotal) > 0.0001) {
    throw new Error('Quotation converted value conflicts with the original POS V2 sale. Manual review required.');
  }
}

export function assertExistingQuotationReversalMatches({ existing, expected }) {
  const same = clean(existing?.reversalId) === expected.reversalId
    && clean(existing?.revisionId) === expected.revisionId
    && clean(existing?.tenantId) === expected.tenantId
    && clean(existing?.branchId) === expected.branchId
    && clean(existing?.saleId) === expected.saleId
    && clean(existing?.quotationId) === expected.quotationId
    && clean(existing?.requestedBy) === expected.requestedBy
    && normalizedReason(existing?.reason) === expected.reason
    && clean(existing?.priorStatus) === expected.priorStatus
    && clean(existing?.restoredStatus) === expected.restoredStatus;
  if (!same) throw new Error('Existing quotation reversal conflicts with the requested revision. Manual review required.');
}
