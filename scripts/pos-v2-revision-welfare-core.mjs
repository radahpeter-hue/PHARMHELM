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

export function welfareComponentAmount(payment) {
  return (Array.isArray(payment?.components) ? payment.components : [])
    .filter(row => clean(row?.method) === 'staff_welfare')
    .reduce((sum, row) => sum + Math.max(0, numberValue(row?.amount)), 0);
}

export function welfareReversalIds({ tenantId, saleId, revisionId }) {
  if (!clean(tenantId) || !clean(saleId) || !clean(revisionId)) {
    throw new Error('Welfare reversal identity is incomplete.');
  }
  const key = stablePart(`${tenantId}_${saleId}_${revisionId}`, 170);
  return {
    reversalId: `pos_welfare_reversal_${key}`.slice(0, 240),
    welfareId: `pos_welfare_reversal_entry_${key}`.slice(0, 240),
    expenseId: `pos_welfare_reversal_expense_${key}`.slice(0, 240),
    transferId: `pos_welfare_reversal_transfer_${key}`.slice(0, 240)
  };
}

export function validateWelfareOriginals({ sale, payment, welfare, expense, transfer, beneficiary, expectedAmount }) {
  if (!sale || Number(sale.engineVersion || 0) !== 2 || sale.status !== 'completed') {
    throw new Error('Welfare reversal requires a completed POS V2 sale.');
  }
  const amount = numberValue(expectedAmount, NaN);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Welfare reversal amount must be positive.');
  if (!payment || Number(payment.engineVersion || 0) !== 2 || payment.saleId !== sale.id) {
    throw new Error('Welfare reversal canonical payment linkage mismatch.');
  }
  if (!welfare || !expense || !transfer) throw new Error('Original welfare financial postings are incomplete.');
  if ([welfare, expense, transfer, beneficiary].some(row => row?.tenantId !== sale.tenantId)) {
    throw new Error('Welfare reversal tenant linkage mismatch.');
  }
  if (welfare.saleId !== sale.id || expense.saleId !== sale.id || transfer.saleId !== sale.id) {
    throw new Error('Welfare reversal sale linkage mismatch.');
  }
  if (Math.abs(numberValue(welfare.amount, NaN) - amount) > EPSILON
    || Math.abs(numberValue(expense.amount, NaN) - amount) > EPSILON
    || Math.abs(numberValue(transfer.amount, NaN) - amount) > EPSILON) {
    throw new Error('Original welfare posting amounts do not reconcile.');
  }
  const beneficiaryId = clean(welfare.staffId);
  if (!beneficiaryId || beneficiaryId !== clean(sale.patientId)) {
    throw new Error('Welfare beneficiary linkage mismatch.');
  }
  const spent = numberValue(beneficiary?.welfare_spent, NaN);
  const ytd = numberValue(beneficiary?.welfare_used_ytd, NaN);
  if (!Number.isFinite(spent) || !Number.isFinite(ytd) || spent + EPSILON < amount || ytd + EPSILON < amount) {
    throw new Error('Welfare reversal would create a negative beneficiary balance.');
  }
  return true;
}

export function buildWelfareReversal({ sale, payment, revisionId, requestedBy, requestedByName, reason }) {
  const amount = welfareComponentAmount(payment);
  if (amount <= 0) throw new Error('Canonical payment has no staff welfare amount to reverse.');
  const ids = welfareReversalIds({ tenantId: sale?.tenantId, saleId: sale?.id, revisionId });
  const actor = clean(requestedBy);
  const actorName = clean(requestedByName);
  const normalizedReason = clean(reason).replace(/\s+/g, ' ');
  if (!actor || !actorName) throw new Error('Welfare reversal actor is incomplete.');
  if (normalizedReason.length < 8 || normalizedReason.length > 500) throw new Error('Welfare reversal reason must contain 8 to 500 characters.');
  return {
    ...ids,
    revisionId: clean(revisionId),
    originalSaleId: sale.id,
    originalReceiptNumber: sale.receiptNumber,
    originalPaymentId: payment.paymentId,
    tenantId: sale.tenantId,
    branchId: sale.branchId,
    amount,
    amountDelta: -amount,
    requestedBy: actor,
    requestedByName: actorName,
    reason: normalizedReason,
    source: 'POS_REVISION',
    engineVersion: 2,
    payloadVersion: 1
  };
}

export function assertExistingWelfareReversalMatches({ existing, expected }) {
  if (!existing) return false;
  for (const field of ['reversalId', 'revisionId', 'originalSaleId', 'originalPaymentId', 'tenantId', 'branchId']) {
    if (existing[field] !== expected[field]) throw new Error('Welfare reversal identity conflict. Manual review required.');
  }
  if (Math.abs(numberValue(existing.amountDelta, NaN) - numberValue(expected.amountDelta, NaN)) > EPSILON) {
    throw new Error('Welfare reversal amount conflict. Manual review required.');
  }
  return true;
}