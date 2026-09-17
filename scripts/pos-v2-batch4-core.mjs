export const BATCH4_CONSUMERS = ['consumption', 'welfare', 'institutionalCredit', 'quotation'];

export const CONSUMER_STATUSES = ['NOT_APPLICABLE', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'];

export const GLOBAL_STATUSES = ['PENDING', 'PROCESSING', 'PROCESSED', 'FAILED'];

export const MAX_CONSUMER_ATTEMPTS = 5;
export const DEFAULT_LEASE_SECONDS = 300;

export function stablePart(value, max = 180) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, max);
}

export function welfarePostingIds(tenantId, saleId) {
  const key = stablePart(`${tenantId}_${saleId}`);
  return {
    welfareId: `pos_welfare_${key}`,
    expenseId: `pos_welfare_expense_${key}`,
    transferId: `pos_welfare_transfer_${key}`
  };
}

export function movementEventId({ saleId, productId, isReversal = false }) {
  return isReversal
    ? `sales_${saleId}_${productId}_reversal_${productId}`
    : `sales_${saleId}_${productId}_${productId}`;
}

export function consumptionSummaryId(tenantId, branchId, productId, dateKey) {
  return `${tenantId}_${branchId}_${productId}_${dateKey}`;
}

export function dateKeyForTimezone(date, timezone = 'Africa/Kampala') {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) throw new Error('Invalid effective date for POS consumption posting.');
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = formatter.formatToParts(value);
    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    return `${year}-${month}-${day}`;
  } catch {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
  }
}

export function numberValue(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function paymentComponentAmount(payment, method) {
  const components = Array.isArray(payment?.components) ? payment.components : [];
  return components
    .filter(component => String(component?.method || '') === method)
    .reduce((sum, component) => sum + Math.max(0, numberValue(component?.amount)), 0);
}

export function groupedSaleProducts(sale) {
  const groups = new Map();
  for (const item of Array.isArray(sale?.items) ? sale.items : []) {
    if (item?.isService || !item?.productId) continue;
    const rows = groups.get(item.productId) || [];
    rows.push(item);
    groups.set(item.productId, rows);
  }
  return groups;
}

export function snapshotBaseQuantityForItem(item) {
  const quantity = Number(item?.commercialQuantity ?? item?.quantity ?? 0);
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Sale item quantity is invalid.');

  const explicit = Number(item?.baseQuantity);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const multiplier = Number(item?.tierMultiplier);
  if (item?.tierCode) {
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      throw new Error(`Historical tier multiplier is missing for ${item?.productName || item?.productId || 'sale item'}.`);
    }
    return quantity * multiplier;
  }

  return null;
}

export function consumerApplicability({ sale, payment }) {
  const productGroups = groupedSaleProducts(sale);
  const welfareAmount = paymentComponentAmount(payment, 'staff_welfare');
  const institutionalCreditAmount = paymentComponentAmount(payment, 'institutional_credit');
  const sourceQuotationId = String(sale?.sourceQuotationId || '').trim();

  return {
    consumption: productGroups.size > 0,
    welfare: welfareAmount > 0,
    institutionalCredit: institutionalCreditAmount > 0,
    quotation: Boolean(sourceQuotationId)
  };
}

export function createConsumerState(applicable, nowIso) {
  if (!applicable) {
    return {
      status: 'NOT_APPLICABLE',
      attemptCount: 0,
      lastError: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: nowIso,
      updatedAt: nowIso
    };
  }
  return {
    status: 'PENDING',
    attemptCount: 0,
    lastError: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    completedAt: null,
    updatedAt: nowIso
  };
}

export function initializeConsumers({ sale, payment, existingConsumers = {}, nowIso }) {
  const applicability = consumerApplicability({ sale, payment });
  const consumers = {};
  for (const name of BATCH4_CONSUMERS) {
    consumers[name] = existingConsumers?.[name] || createConsumerState(applicability[name], nowIso);
  }
  return consumers;
}

export function deriveGlobalStatus(consumers) {
  const states = BATCH4_CONSUMERS.map(name => consumers?.[name]?.status || 'PENDING');
  const applicable = states.filter(status => status !== 'NOT_APPLICABLE');
  if (applicable.length === 0) return 'PROCESSED';
  if (applicable.every(status => status === 'COMPLETED')) return 'PROCESSED';
  if (applicable.some(status => status === 'PROCESSING')) return 'PROCESSING';
  if (applicable.some(status => status === 'FAILED')) return 'FAILED';
  return 'PENDING';
}

export function validateEnvelope({ event, sale, payment }) {
  if (!event || event.eventType !== 'POS_SALE_COMMITTED' || event.engineVersion !== 2) {
    throw new Error('Unsupported POS outbox event.');
  }
  if (!sale || !payment) throw new Error('Canonical sale or payment document is missing.');
  if (sale.engineVersion !== 2 || payment.engineVersion !== 2) throw new Error('Canonical POS V2 engine version mismatch.');
  if (event.saleId !== sale.id || payment.saleId !== sale.id) throw new Error('Sale linkage mismatch.');
  if (event.paymentId !== payment.paymentId) throw new Error('Payment linkage mismatch.');
  if (event.tenantId !== sale.tenantId || payment.tenantId !== sale.tenantId) throw new Error('Tenant linkage mismatch.');
  if (event.branchId !== sale.branchId || payment.branchId !== sale.branchId) throw new Error('Branch linkage mismatch.');
  if (event.receiptNumber !== sale.receiptNumber || payment.receiptNumber !== sale.receiptNumber) throw new Error('Receipt linkage mismatch.');
  const saleTotal = numberValue(sale.totalAmount ?? sale.total);
  const paymentAmount = numberValue(payment.amount);
  if (Math.abs(saleTotal - paymentAmount) > 0.0001) throw new Error('Canonical sale and payment amounts do not reconcile.');
}

export function structuredError(error) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  return {
    message: message.slice(0, 1000),
    name: error instanceof Error ? error.name : 'Error'
  };
}
