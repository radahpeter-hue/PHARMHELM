export const REVISION_REQUEST_TYPE = 'POS_SALE_REVISION_REQUESTED';
export const REVISION_STATUSES = [
  'PENDING',
  'PROCESSING',
  'REVERSAL_COMPLETE',
  'REPLACEMENT_PENDING',
  'COMPLETED',
  'FAILED'
];

export const REVERSAL_CONSUMERS = [
  'inventory',
  'consumption',
  'welfare',
  'institutionalCredit',
  'quotation'
];

const EPSILON = 0.0001;

function clean(value) {
  return String(value ?? '').trim();
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function canonicalSaleTotal(sale) {
  return numberValue(sale?.totalAmount ?? sale?.total, NaN);
}

export function validateRevisionRequest({ request, sale, payment, outbox, resume = false }) {
  if (!request || request.requestType !== REVISION_REQUEST_TYPE) {
    throw new Error('Unsupported POS revision request.');
  }
  if (request.engineVersion !== 2 || request.payloadVersion !== 1) {
    throw new Error('POS revision request version mismatch.');
  }
  if (request.status !== 'PENDING') {
    throw new Error('A new POS revision request must start PENDING.');
  }
  if (!clean(request.requestId) || !clean(request.revisionId)) {
    throw new Error('POS revision request identity is incomplete.');
  }
  if (!clean(request.requestedBy) || !clean(request.requestedByName)) {
    throw new Error('POS revision request actor is incomplete.');
  }
  const reason = clean(request.reason).replace(/\s+/g, ' ');
  if (reason.length < 8 || reason.length > 500) {
    throw new Error('POS revision reason must contain 8 to 500 characters.');
  }
  if (!sale || Number(sale.engineVersion || 0) !== 2 || sale.status !== 'completed') {
    throw new Error('Only a completed canonical POS V2 sale can be revised.');
  }

  const hasRevisionLock = Boolean(sale.revisionLocked || clean(sale.revisionId) || clean(sale.supersededBySaleId));
  if (hasRevisionLock) {
    const sameRevisionResume = resume === true
      && sale.revisionLocked === true
      && clean(sale.revisionId) === clean(request.revisionId)
      && clean(sale.revisionLifecycle) === 'REVERSAL_PENDING'
      && !clean(sale.supersededBySaleId);
    if (!sameRevisionResume) {
      throw new Error('The original POS V2 sale is already locked by a revision lifecycle.');
    }
  }

  if (!payment || Number(payment.engineVersion || 0) !== 2) {
    throw new Error('Canonical V2 payment is missing or invalid.');
  }
  if (!outbox || outbox.eventType !== 'POS_SALE_COMMITTED' || Number(outbox.engineVersion || 0) !== 2) {
    throw new Error('Canonical POS sale outbox event is missing or invalid.');
  }
  if (outbox.status !== 'PROCESSED') {
    throw new Error('The original POS sale must finish downstream posting before revision starts.');
  }

  if (request.originalSaleId !== sale.id || payment.saleId !== sale.id || outbox.saleId !== sale.id) {
    throw new Error('POS revision sale linkage mismatch.');
  }
  if (request.tenantId !== sale.tenantId || payment.tenantId !== sale.tenantId || outbox.tenantId !== sale.tenantId) {
    throw new Error('POS revision tenant linkage mismatch.');
  }
  if (request.branchId !== sale.branchId || payment.branchId !== sale.branchId || outbox.branchId !== sale.branchId) {
    throw new Error('POS revision branch linkage mismatch.');
  }
  if (request.originalReceiptNumber !== sale.receiptNumber || payment.receiptNumber !== sale.receiptNumber || outbox.receiptNumber !== sale.receiptNumber) {
    throw new Error('POS revision receipt linkage mismatch.');
  }
  if (outbox.paymentId !== payment.paymentId) {
    throw new Error('POS revision canonical payment linkage mismatch.');
  }
  if (clean(sale.canonicalPaymentId) && sale.canonicalPaymentId !== payment.paymentId) {
    throw new Error('Sale canonicalPaymentId does not match the payment record.');
  }
  if (clean(sale.transactionOutboxEventId) && sale.transactionOutboxEventId !== outbox.eventId) {
    throw new Error('Sale transactionOutboxEventId does not match the original outbox event.');
  }

  const saleTotal = canonicalSaleTotal(sale);
  if (!Number.isFinite(saleTotal) || Math.abs(saleTotal - numberValue(payment.amount, NaN)) > EPSILON) {
    throw new Error('Original sale and payment amounts do not reconcile.');
  }

  return true;
}

export function initializeReversalConsumers(applicability = {}, existing = {}) {
  const consumers = {};
  for (const name of REVERSAL_CONSUMERS) {
    if (existing?.[name]) {
      consumers[name] = { ...existing[name] };
      continue;
    }
    consumers[name] = applicability[name]
      ? { status: 'PENDING', attemptCount: 0, lastError: null }
      : { status: 'NOT_APPLICABLE', attemptCount: 0, lastError: null };
  }
  return consumers;
}

export function deriveReversalState(consumers = {}) {
  const states = REVERSAL_CONSUMERS.map(name => consumers?.[name]?.status || 'PENDING');
  const applicable = states.filter(status => status !== 'NOT_APPLICABLE');
  if (applicable.length === 0 || applicable.every(status => status === 'COMPLETED')) return 'REVERSAL_COMPLETE';
  if (applicable.some(status => status === 'FAILED')) return 'FAILED';
  if (applicable.some(status => status === 'PROCESSING')) return 'PROCESSING';
  return 'PENDING';
}

const ALLOWED_TRANSITIONS = new Map([
  ['PENDING', new Set(['PROCESSING', 'FAILED'])],
  ['PROCESSING', new Set(['PROCESSING', 'REVERSAL_COMPLETE', 'FAILED'])],
  ['FAILED', new Set(['PROCESSING', 'FAILED'])],
  ['REVERSAL_COMPLETE', new Set(['REPLACEMENT_PENDING', 'FAILED'])],
  ['REPLACEMENT_PENDING', new Set(['COMPLETED', 'FAILED'])],
  ['COMPLETED', new Set(['COMPLETED'])]
]);

export function assertRevisionTransition(from, to) {
  if (!REVISION_STATUSES.includes(from) || !REVISION_STATUSES.includes(to)) {
    throw new Error('Unknown POS revision lifecycle status.');
  }
  if (!ALLOWED_TRANSITIONS.get(from)?.has(to)) {
    throw new Error(`Illegal POS revision transition ${from} -> ${to}.`);
  }
  return true;
}

function stablePart(value, max = 180) {
  return clean(value).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, max);
}

export function revisionMovementEventId({ originalSaleId, productId, revisionId }) {
  return `sales_${stablePart(originalSaleId)}_${stablePart(productId)}_revision_${stablePart(revisionId)}`.slice(0, 240);
}

export function revisionAuditId({ originalSaleId, revisionId }) {
  return `audit_pos_revision_${stablePart(originalSaleId)}_${stablePart(revisionId)}`.slice(0, 240);
}