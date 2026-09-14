import { PosCheckoutV2Error } from './posCheckoutV2Errors';
import type {
  CheckoutV2Request,
  PosCheckoutV2OutboxEvent,
  PosCheckoutV2Payment,
  PosCheckoutV2PaymentComponent,
  PosCheckoutV2PaymentStatus
} from './posCheckoutV2Types';

const EPSILON = 0.0001;

export const POS_V2_SUPPORTED_PAYMENT_METHODS = [
  'cash',
  'mtn_momo',
  'airtel_money',
  'card',
  'insurance',
  'institutional_credit',
  'staff_welfare',
  // Retain historical aliases already present in the shared Sale type / older records.
  'momo',
  'airtel',
  'credit'
] as const;

// Current V1 welfare split UI deliberately exposes only these three settlement methods.
const WELFARE_SECONDARY_METHODS = new Set(['cash', 'mtn_momo', 'airtel_money']);
const UNSETTLED_METHODS = new Set(['insurance', 'institutional_credit', 'credit']);

function normalizeAmount(value: unknown, fieldName: string): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new PosCheckoutV2Error('PAYMENT_MISMATCH', `${fieldName} must be a finite non-negative amount.`);
  }
  return amount;
}

function assertMoneyEqual(left: number, right: number, message: string) {
  if (Math.abs(left - right) > EPSILON) {
    throw new PosCheckoutV2Error('PAYMENT_MISMATCH', message, { left, right });
  }
}

export function isSupportedPosV2PaymentMethod(method: string): boolean {
  return (POS_V2_SUPPORTED_PAYMENT_METHODS as readonly string[]).includes(String(method || '').trim());
}

export function posCheckoutV2PaymentDocumentId(saleId: string): string {
  return `pos_payment_${saleId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 240);
}

export function posCheckoutV2OutboxEventDocumentId(saleId: string, eventType = 'POS_SALE_COMMITTED'): string {
  return `pos_outbox_${saleId}_${eventType}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 240);
}

function component(method: string, amount: number): PosCheckoutV2PaymentComponent {
  const unsettled = UNSETTLED_METHODS.has(method);
  return {
    method,
    amount,
    settledAmount: unsettled ? 0 : amount,
    outstandingAmount: unsettled ? amount : 0,
    status: unsettled ? 'unpaid' : 'settled'
  };
}

export function buildPosCheckoutV2Payment(params: {
  request: CheckoutV2Request;
  saleId: string;
  receiptNumber: string;
  tenantId: string;
  branchId: string;
  operatorUid: string;
  authoritativeTotal: number;
  paymentId: string;
}): PosCheckoutV2Payment {
  const { request, authoritativeTotal } = params;
  const total = normalizeAmount(authoritativeTotal, 'Authoritative sale total');
  const method = String(request.paymentMethod || 'cash').trim();

  if (!isSupportedPosV2PaymentMethod(method)) {
    throw new PosCheckoutV2Error('PAYMENT_MISMATCH', `Unsupported POS payment method: ${method || '(empty)'}.`);
  }

  const components: PosCheckoutV2PaymentComponent[] = [];

  if (method === 'staff_welfare' && request.secondaryPaymentMethod) {
    const secondaryMethod = String(request.secondaryPaymentMethod).trim();
    if (!WELFARE_SECONDARY_METHODS.has(secondaryMethod)) {
      throw new PosCheckoutV2Error('PAYMENT_MISMATCH', 'The welfare split contains a secondary payment method that is not offered by the current POS workflow.');
    }
    const secondaryAmount = normalizeAmount(request.secondaryAmount, 'Secondary payment amount');
    const welfareAmount = normalizeAmount(request.welfareAmount, 'Staff welfare amount');
    assertMoneyEqual(welfareAmount + secondaryAmount, total, 'The welfare and secondary payment components must equal the authoritative sale total.');
    components.push(component('staff_welfare', welfareAmount), component(secondaryMethod, secondaryAmount));
  } else {
    if (request.secondaryPaymentMethod != null || request.secondaryAmount != null) {
      throw new PosCheckoutV2Error('PAYMENT_MISMATCH', 'Secondary payment fields are only valid for the existing staff-welfare split workflow.');
    }
    if (method === 'staff_welfare' && request.welfareAmount != null) {
      assertMoneyEqual(normalizeAmount(request.welfareAmount, 'Staff welfare amount'), total, 'Staff welfare amount must equal the authoritative sale total when no split applies.');
    }
    components.push(component(method, total));
  }

  const settledAmount = components.reduce((sum, row) => sum + row.settledAmount, 0);
  const outstandingAmount = components.reduce((sum, row) => sum + row.outstandingAmount, 0);
  assertMoneyEqual(settledAmount + outstandingAmount, total, 'Canonical payment components do not reconcile to the authoritative sale total.');

  let status: PosCheckoutV2PaymentStatus = 'completed';
  if (outstandingAmount > EPSILON && settledAmount > EPSILON) status = 'partially_settled';
  else if (outstandingAmount > EPSILON) status = 'unpaid';

  return {
    paymentId: params.paymentId,
    saleId: params.saleId,
    receiptNumber: params.receiptNumber,
    checkoutAttemptId: request.attemptId,
    tenantId: params.tenantId,
    branchId: params.branchId,
    customerId: request.customerId,
    patientId: request.patientId,
    institutionId: request.institutionId,
    paymentMethod: method,
    currency: 'UGX',
    amount: total,
    settledAmount,
    outstandingAmount,
    status,
    components,
    operatorUid: params.operatorUid,
    source: 'POS',
    engineVersion: 2
  };
}

export function buildPosCheckoutV2OutboxEvent(params: {
  eventId: string;
  saleId: string;
  paymentId: string;
  receiptNumber: string;
  tenantId: string;
  branchId: string;
}): PosCheckoutV2OutboxEvent {
  return {
    eventId: params.eventId,
    eventType: 'POS_SALE_COMMITTED',
    aggregateType: 'POS_SALE',
    aggregateId: params.saleId,
    saleId: params.saleId,
    paymentId: params.paymentId,
    receiptNumber: params.receiptNumber,
    tenantId: params.tenantId,
    branchId: params.branchId,
    engineVersion: 2,
    payloadVersion: 1,
    status: 'PENDING',
    attemptCount: 0,
    source: 'POS',
    payload: {
      saleId: params.saleId,
      paymentId: params.paymentId
    }
  };
}
