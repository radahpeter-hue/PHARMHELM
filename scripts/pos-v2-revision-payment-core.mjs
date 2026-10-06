const EPSILON = 0.0001;

function clean(value) {
  return String(value ?? '').trim();
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function negativeDelta(value) {
  const amount = numberValue(value);
  return amount === 0 ? 0 : -amount;
}

function stablePart(value, max = 180) {
  return clean(value).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, max);
}

export function paymentReversalId({ paymentId, revisionId }) {
  if (!clean(paymentId) || !clean(revisionId)) throw new Error('Payment reversal identity is incomplete.');
  return `pos_payment_reversal_${stablePart(paymentId)}_${stablePart(revisionId)}`.slice(0, 240);
}

export function validatePaymentForRevision({ payment, sale, revisionId }) {
  if (!payment || Number(payment.engineVersion || 0) !== 2) throw new Error('Canonical POS V2 payment is missing or invalid.');
  if (!sale || Number(sale.engineVersion || 0) !== 2 || sale.status !== 'completed') throw new Error('Payment reversal requires a completed POS V2 sale.');
  if (!clean(revisionId)) throw new Error('Payment reversal requires a revisionId.');
  if (payment.saleId !== sale.id) throw new Error('Payment reversal sale linkage mismatch.');
  if (payment.tenantId !== sale.tenantId) throw new Error('Payment reversal tenant linkage mismatch.');
  if (payment.branchId !== sale.branchId) throw new Error('Payment reversal branch linkage mismatch.');
  if (payment.receiptNumber !== sale.receiptNumber) throw new Error('Payment reversal receipt linkage mismatch.');
  if (clean(sale.canonicalPaymentId) && sale.canonicalPaymentId !== payment.paymentId) {
    throw new Error('Payment reversal canonical payment linkage mismatch.');
  }

  const amount = numberValue(payment.amount, NaN);
  const settledAmount = numberValue(payment.settledAmount, NaN);
  const outstandingAmount = numberValue(payment.outstandingAmount, NaN);
  if (![amount, settledAmount, outstandingAmount].every(Number.isFinite) || amount < 0 || settledAmount < 0 || outstandingAmount < 0) {
    throw new Error('Canonical payment amounts are invalid.');
  }
  if (Math.abs(settledAmount + outstandingAmount - amount) > EPSILON) {
    throw new Error('Canonical payment amounts do not reconcile.');
  }
  const saleTotal = numberValue(sale.totalAmount ?? sale.total, NaN);
  if (!Number.isFinite(saleTotal) || Math.abs(saleTotal - amount) > EPSILON) {
    throw new Error('Canonical sale and payment totals do not reconcile for reversal.');
  }

  const components = Array.isArray(payment.components) ? payment.components : [];
  const componentAmount = components.reduce((sum, row) => sum + numberValue(row?.amount, NaN), 0);
  if (components.length === 0 || !Number.isFinite(componentAmount) || Math.abs(componentAmount - amount) > EPSILON) {
    throw new Error('Canonical payment components do not reconcile for reversal.');
  }
  return true;
}

export function buildPaymentReversal({ payment, sale, revisionId, requestedBy, requestedByName, reason }) {
  validatePaymentForRevision({ payment, sale, revisionId });
  const actor = clean(requestedBy);
  const actorName = clean(requestedByName);
  const normalizedReason = clean(reason).replace(/\s+/g, ' ');
  if (!actor || !actorName) throw new Error('Payment reversal actor is incomplete.');
  if (normalizedReason.length < 8 || normalizedReason.length > 500) throw new Error('Payment reversal reason must contain 8 to 500 characters.');

  const components = payment.components.map(row => ({
    method: clean(row.method),
    originalAmount: numberValue(row.amount),
    originalSettledAmount: numberValue(row.settledAmount),
    originalOutstandingAmount: numberValue(row.outstandingAmount),
    amountDelta: negativeDelta(row.amount),
    settledDelta: negativeDelta(row.settledAmount),
    outstandingDelta: negativeDelta(row.outstandingAmount),
    originalStatus: row.status || null
  }));

  return {
    reversalId: paymentReversalId({ paymentId: payment.paymentId, revisionId }),
    revisionId: clean(revisionId),
    originalPaymentId: payment.paymentId,
    originalSaleId: sale.id,
    originalReceiptNumber: sale.receiptNumber,
    tenantId: sale.tenantId,
    branchId: sale.branchId,
    currency: payment.currency || 'UGX',
    originalPaymentMethod: payment.paymentMethod,
    originalAmount: numberValue(payment.amount),
    originalSettledAmount: numberValue(payment.settledAmount),
    originalOutstandingAmount: numberValue(payment.outstandingAmount),
    amountDelta: negativeDelta(payment.amount),
    settledDelta: negativeDelta(payment.settledAmount),
    outstandingDelta: negativeDelta(payment.outstandingAmount),
    components,
    requestedBy: actor,
    requestedByName: actorName,
    reason: normalizedReason,
    source: 'POS_REVISION',
    engineVersion: 2,
    payloadVersion: 1
  };
}

export function assertExistingPaymentReversalMatches({ existing, expected }) {
  if (!existing) return false;
  const identityFields = [
    'reversalId',
    'revisionId',
    'originalPaymentId',
    'originalSaleId',
    'originalReceiptNumber',
    'tenantId',
    'branchId'
  ];
  for (const field of identityFields) {
    if (existing[field] !== expected[field]) throw new Error('Payment reversal identity conflict. Manual review required.');
  }
  if (Math.abs(numberValue(existing.amountDelta, NaN) - numberValue(expected.amountDelta, NaN)) > EPSILON
    || Math.abs(numberValue(existing.settledDelta, NaN) - numberValue(expected.settledDelta, NaN)) > EPSILON
    || Math.abs(numberValue(existing.outstandingDelta, NaN) - numberValue(expected.outstandingDelta, NaN)) > EPSILON) {
    throw new Error('Payment reversal amount conflict. Manual review required.');
  }
  return true;
}