const EPSILON = 0.0001;

function clean(value) {
  return String(value ?? '').trim();
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stablePart(value, max = 180) {
  return clean(value).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, max);
}

export function institutionalCreditAmount(payment) {
  return (Array.isArray(payment?.components) ? payment.components : [])
    .filter(row => clean(row?.method) === 'institutional_credit')
    .reduce((sum, row) => sum + Math.max(0, numberValue(row?.amount)), 0);
}

export function institutionalCreditReversalId({ tenantId, saleId, revisionId }) {
  if (!clean(tenantId) || !clean(saleId) || !clean(revisionId)) {
    throw new Error('Institutional credit reversal identity is incomplete.');
  }
  return `pos_credit_reversal_${stablePart(`${tenantId}_${saleId}_${revisionId}`, 200)}`.slice(0, 240);
}

export function validateInstitutionalCreditOriginal({ sale, payment, receivable, expectedAmount }) {
  if (!sale || Number(sale.engineVersion || 0) !== 2 || sale.status !== 'completed') {
    throw new Error('Institutional credit reversal requires a completed POS V2 sale.');
  }
  const amount = numberValue(expectedAmount, NaN);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Institutional credit reversal amount must be positive.');
  }
  if (!payment || Number(payment.engineVersion || 0) !== 2 || payment.saleId !== sale.id) {
    throw new Error('Institutional credit canonical payment linkage mismatch.');
  }
  if (!receivable) throw new Error('Original institutional credit receivable is missing.');
  if (receivable.tenantId !== sale.tenantId || clean(receivable.receipt_id || sale.id) !== sale.id) {
    throw new Error('Institutional credit receivable linkage mismatch.');
  }
  if (clean(receivable.paymentId) && clean(receivable.paymentId) !== clean(payment.paymentId)) {
    throw new Error('Institutional credit receivable payment linkage mismatch.');
  }
  const original = numberValue(receivable.amount_ugx, NaN);
  const outstanding = numberValue(receivable.outstanding_ugx, NaN);
  if (!Number.isFinite(original) || Math.abs(original - amount) > EPSILON) {
    throw new Error('Institutional credit receivable amount does not reconcile with canonical payment.');
  }
  if (!Number.isFinite(outstanding) || Math.abs(outstanding - amount) > EPSILON) {
    throw new Error('Institutional credit has already been partially or fully settled. Manual review is required before receipt revision.');
  }
  return true;
}

export function buildInstitutionalCreditReversal({ sale, payment, revisionId, requestedBy, requestedByName, reason }) {
  const amount = institutionalCreditAmount(payment);
  if (amount <= 0) throw new Error('Canonical payment has no institutional credit amount to reverse.');
  const actor = clean(requestedBy);
  const actorName = clean(requestedByName);
  const normalizedReason = clean(reason).replace(/\s+/g, ' ');
  if (!actor || !actorName) throw new Error('Institutional credit reversal actor is incomplete.');
  if (normalizedReason.length < 8 || normalizedReason.length > 500) {
    throw new Error('Institutional credit reversal reason must contain 8 to 500 characters.');
  }
  return {
    reversalId: institutionalCreditReversalId({ tenantId: sale?.tenantId, saleId: sale?.id, revisionId }),
    revisionId: clean(revisionId),
    originalSaleId: sale.id,
    originalReceiptNumber: sale.receiptNumber,
    originalPaymentId: payment.paymentId,
    originalReceivableId: sale.id,
    tenantId: sale.tenantId,
    branchId: sale.branchId,
    amount,
    amountDelta: -amount,
    outstandingDelta: -amount,
    requestedBy: actor,
    requestedByName: actorName,
    reason: normalizedReason,
    source: 'POS_REVISION',
    engineVersion: 2,
    payloadVersion: 1
  };
}

export function assertExistingInstitutionalCreditReversalMatches({ existing, expected }) {
  if (!existing) return false;
  for (const field of ['reversalId', 'revisionId', 'originalSaleId', 'originalPaymentId', 'originalReceivableId', 'tenantId', 'branchId']) {
    if (existing[field] !== expected[field]) {
      throw new Error('Institutional credit reversal identity conflict. Manual review required.');
    }
  }
  if (Math.abs(numberValue(existing.amountDelta, NaN) - numberValue(expected.amountDelta, NaN)) > EPSILON) {
    throw new Error('Institutional credit reversal amount conflict. Manual review required.');
  }
  return true;
}
