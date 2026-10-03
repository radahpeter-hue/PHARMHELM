import type { Sale, SaleItem } from '../../types';
import type { PosCheckoutV2Payment } from './posCheckoutV2Types';

export interface PosV2OriginalOutboxSnapshot {
  eventId: string;
  eventType: string;
  saleId: string;
  paymentId: string;
  receiptNumber: string;
  tenantId: string;
  branchId: string;
  engineVersion: number;
  status: string;
  consumers?: Record<string, { status?: string } | undefined>;
}

export interface PosV2BatchRestore {
  batchId: string;
  batchNumber: string;
  productId: string;
  baseQuantity: number;
}

export interface PosV2ProductRestore {
  productId: string;
  baseQuantity: number;
}

export interface PosV2CompensationPlan {
  originalSaleId: string;
  originalReceiptNumber: string;
  tenantId: string;
  branchId: string;
  canonicalPaymentId: string;
  originalOutboxEventId: string;
  batchRestores: PosV2BatchRestore[];
  productRestores: PosV2ProductRestore[];
  totalBaseUnitsReturned: number;
  financial: {
    paymentAmount: number;
    settledAmount: number;
    outstandingAmount: number;
    paymentMethod: string;
    requiresWelfareReversal: boolean;
    requiresInstitutionalCreditReversal: boolean;
    requiresQuotationReversal: boolean;
  };
  downstream: {
    consumption: boolean;
    welfare: boolean;
    institutionalCredit: boolean;
    quotation: boolean;
  };
}

const EPSILON = 0.0001;

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function paymentComponentAmount(payment: PosCheckoutV2Payment, method: string): number {
  return (payment.components || [])
    .filter(component => clean(component.method) === method)
    .reduce((sum, component) => sum + Math.max(0, numberValue(component.amount)), 0);
}

function expectedStoredBaseQuantity(item: SaleItem): number {
  const explicit = numberValue((item as any).baseQuantity, NaN);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const commercial = numberValue((item as any).commercialQuantity ?? item.quantity, NaN);
  const multiplier = numberValue((item as any).tierMultiplier, NaN);
  if (clean((item as any).tierCode) && Number.isFinite(commercial) && commercial > 0 && Number.isFinite(multiplier) && multiplier > 0) {
    return commercial * multiplier;
  }

  throw new Error(`Immutable base-unit history is missing for ${item.productName || item.name || item.productId}.`);
}

function assertCanonicalChain(sale: Sale, payment: PosCheckoutV2Payment, outbox: PosV2OriginalOutboxSnapshot): void {
  if (Number(sale.engineVersion || 0) !== 2) throw new Error('Only POS V2 sales can enter the V2 compensation planner.');
  if (sale.status !== 'completed') throw new Error('Only a completed POS V2 sale can be compensated.');
  if (Number(payment.engineVersion || 0) !== 2) throw new Error('Canonical payment engine version mismatch.');
  if (outbox.eventType !== 'POS_SALE_COMMITTED' || Number(outbox.engineVersion || 0) !== 2) {
    throw new Error('The original durable POS outbox event is not a canonical V2 sale event.');
  }

  if (payment.saleId !== sale.id || outbox.saleId !== sale.id) throw new Error('Canonical sale linkage mismatch.');
  if (payment.paymentId !== outbox.paymentId) throw new Error('Canonical payment linkage mismatch.');
  if (payment.tenantId !== sale.tenantId || outbox.tenantId !== sale.tenantId) throw new Error('Canonical tenant linkage mismatch.');
  if (payment.branchId !== sale.branchId || outbox.branchId !== sale.branchId) throw new Error('Canonical branch linkage mismatch.');
  if (payment.receiptNumber !== sale.receiptNumber || outbox.receiptNumber !== sale.receiptNumber) throw new Error('Canonical receipt linkage mismatch.');

  const expectedPaymentId = clean((sale as any).canonicalPaymentId);
  if (expectedPaymentId && expectedPaymentId !== payment.paymentId) throw new Error('Sale canonicalPaymentId does not match the payment record.');
  const expectedOutboxId = clean((sale as any).transactionOutboxEventId);
  if (expectedOutboxId && expectedOutboxId !== outbox.eventId) throw new Error('Sale transactionOutboxEventId does not match the durable event.');

  const saleTotal = numberValue((sale as any).totalAmount ?? sale.total, NaN);
  if (!Number.isFinite(saleTotal) || Math.abs(saleTotal - numberValue(payment.amount, NaN)) > EPSILON) {
    throw new Error('Canonical sale and payment amounts do not reconcile.');
  }

  if (outbox.status !== 'PROCESSED') {
    throw new Error('The original POS V2 downstream event must be fully PROCESSED before revision compensation can begin.');
  }
}

export function buildPosV2CompensationPlan(params: {
  sale: Sale;
  payment: PosCheckoutV2Payment;
  outbox: PosV2OriginalOutboxSnapshot;
}): PosV2CompensationPlan {
  const { sale, payment, outbox } = params;
  assertCanonicalChain(sale, payment, outbox);

  const batchMap = new Map<string, PosV2BatchRestore>();
  const productMap = new Map<string, PosV2ProductRestore>();
  let totalBaseUnitsReturned = 0;

  for (const item of sale.items || []) {
    if (item.isService) continue;
    const productId = clean(item.productId);
    if (!productId) throw new Error('A stock line is missing its productId.');

    const allocations = Array.isArray(item.batchAllocations) ? item.batchAllocations : [];
    if (allocations.length === 0) {
      throw new Error(`Exact historical batch allocations are missing for ${item.productName || item.name || productId}.`);
    }

    let allocatedBase = 0;
    for (const allocation of allocations) {
      const batchId = clean(allocation.batchId);
      const batchNumber = clean(allocation.batchNumber);
      const baseQuantity = numberValue(allocation.baseQuantity, NaN);
      if (!batchId || !batchNumber || !Number.isFinite(baseQuantity) || baseQuantity <= 0) {
        throw new Error(`A historical allocation is invalid for ${item.productName || item.name || productId}.`);
      }

      allocatedBase += baseQuantity;
      const existing = batchMap.get(batchId);
      if (existing && (existing.productId !== productId || existing.batchNumber !== batchNumber)) {
        throw new Error(`Historical batch ${batchId} is linked inconsistently across sale lines.`);
      }
      batchMap.set(batchId, {
        batchId,
        batchNumber,
        productId,
        baseQuantity: numberValue(existing?.baseQuantity) + baseQuantity
      });
    }

    const expectedBase = expectedStoredBaseQuantity(item);
    if (Math.abs(expectedBase - allocatedBase) > EPSILON) {
      throw new Error(`Historical allocation quantity does not reconcile for ${item.productName || item.name || productId}.`);
    }

    const currentProduct = productMap.get(productId);
    productMap.set(productId, {
      productId,
      baseQuantity: numberValue(currentProduct?.baseQuantity) + allocatedBase
    });
    totalBaseUnitsReturned += allocatedBase;
  }

  const welfareAmount = paymentComponentAmount(payment, 'staff_welfare');
  const institutionalCreditAmount = paymentComponentAmount(payment, 'institutional_credit');
  const consumerStatus = (name: string) => clean(outbox.consumers?.[name]?.status);

  return {
    originalSaleId: sale.id,
    originalReceiptNumber: sale.receiptNumber,
    tenantId: sale.tenantId,
    branchId: sale.branchId,
    canonicalPaymentId: payment.paymentId,
    originalOutboxEventId: outbox.eventId,
    batchRestores: [...batchMap.values()],
    productRestores: [...productMap.values()],
    totalBaseUnitsReturned,
    financial: {
      paymentAmount: numberValue(payment.amount),
      settledAmount: numberValue(payment.settledAmount),
      outstandingAmount: numberValue(payment.outstandingAmount),
      paymentMethod: payment.paymentMethod,
      requiresWelfareReversal: welfareAmount > 0,
      requiresInstitutionalCreditReversal: institutionalCreditAmount > 0,
      requiresQuotationReversal: Boolean(clean((sale as any).sourceQuotationId))
    },
    downstream: {
      consumption: consumerStatus('consumption') === 'COMPLETED',
      welfare: consumerStatus('welfare') === 'COMPLETED' || welfareAmount > 0,
      institutionalCredit: consumerStatus('institutionalCredit') === 'COMPLETED' || institutionalCreditAmount > 0,
      quotation: consumerStatus('quotation') === 'COMPLETED' || Boolean(clean((sale as any).sourceQuotationId))
    }
  };
}
