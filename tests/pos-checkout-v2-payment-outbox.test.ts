import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildPosCheckoutV2OutboxEvent,
  buildPosCheckoutV2Payment,
  posCheckoutV2OutboxEventDocumentId,
  posCheckoutV2PaymentDocumentId
} from '../src/services/pos-v2/posCheckoutV2PaymentOutbox';
import type { CheckoutV2Request } from '../src/services/pos-v2/posCheckoutV2Types';

const baseRequest = (overrides: Partial<CheckoutV2Request> = {}): CheckoutV2Request => ({
  attemptId: 'attempt-1',
  branchId: 'branch-1',
  items: [{
    productId: 'p1',
    name: 'Panadol',
    quantity: 1,
    commercialQuantity: 1,
    unitPrice: 1000,
    actualUnitPrice: 1000,
    costPrice: 500,
    subtotal: 1000,
    total: 1000,
    lineTotal: 1000,
    isService: false
  } as any],
  paymentMethod: 'cash',
  ...overrides
});

const buildPayment = (request: CheckoutV2Request, total = 1000) => buildPosCheckoutV2Payment({
  request,
  saleId: 'sale-1',
  receiptNumber: 'KLA-2026-100001',
  tenantId: 'tenant-1',
  branchId: 'branch-1',
  operatorUid: 'staff-1',
  authoritativeTotal: total,
  paymentId: 'payment-1'
});

test('immediate cash payment is completed for the authoritative sale total', () => {
  const payment = buildPayment(baseRequest());
  assert.equal(payment.amount, 1000);
  assert.equal(payment.settledAmount, 1000);
  assert.equal(payment.outstandingAmount, 0);
  assert.equal(payment.status, 'completed');
  assert.deepEqual(payment.components.map(row => [row.method, row.amount, row.status]), [['cash', 1000, 'settled']]);
});

test('all immediate payment methods exposed by the POS map to settled canonical components', () => {
  for (const method of ['cash', 'mtn_momo', 'airtel_money', 'card']) {
    const payment = buildPayment(baseRequest({ paymentMethod: method }));
    assert.deepEqual(payment.components.map(row => [row.method, row.amount, row.status]), [[method, 1000, 'settled']]);
    assert.equal(payment.status, 'completed');
  }
});

test('institutional credit is represented as unpaid and never as cash received', () => {
  const payment = buildPayment(baseRequest({ paymentMethod: 'institutional_credit' }));
  assert.equal(payment.amount, 1000);
  assert.equal(payment.settledAmount, 0);
  assert.equal(payment.outstandingAmount, 1000);
  assert.equal(payment.status, 'unpaid');
});

test('insurance preserves the legacy receivable semantics rather than fabricating settlement', () => {
  const payment = buildPayment(baseRequest({ paymentMethod: 'insurance' }));
  assert.equal(payment.settledAmount, 0);
  assert.equal(payment.outstandingAmount, 1000);
  assert.equal(payment.status, 'unpaid');
});

test('existing staff-welfare split reconciles exactly to authoritative total', () => {
  const payment = buildPayment(baseRequest({
    paymentMethod: 'staff_welfare',
    welfareAmount: 600,
    secondaryPaymentMethod: 'mtn_momo',
    secondaryAmount: 400
  }));
  assert.equal(payment.amount, 1000);
  assert.equal(payment.settledAmount, 1000);
  assert.equal(payment.outstandingAmount, 0);
  assert.equal(payment.status, 'completed');
  assert.deepEqual(payment.components.map(row => [row.method, row.amount]), [['staff_welfare', 600], ['mtn_momo', 400]]);
});

test('welfare split cannot introduce a payment method that current V1 does not offer', () => {
  assert.throws(() => buildPayment(baseRequest({
    paymentMethod: 'staff_welfare',
    welfareAmount: 600,
    secondaryPaymentMethod: 'card',
    secondaryAmount: 400
  })), (error: any) => error?.code === 'PAYMENT_MISMATCH');
});

test('payment components cannot diverge from the authoritative sale total', () => {
  assert.throws(() => buildPayment(baseRequest({
    paymentMethod: 'staff_welfare',
    welfareAmount: 600,
    secondaryPaymentMethod: 'cash',
    secondaryAmount: 300
  })), (error: any) => error?.code === 'PAYMENT_MISMATCH');
});

test('secondary tender fields cannot be attached to an ordinary immediate payment', () => {
  assert.throws(() => buildPayment(baseRequest({
    paymentMethod: 'cash',
    secondaryPaymentMethod: 'mtn_momo',
    secondaryAmount: 100
  })), (error: any) => error?.code === 'PAYMENT_MISMATCH');
});

test('payment and outbox identities are deterministic from the immutable sale identity', () => {
  assert.equal(posCheckoutV2PaymentDocumentId('sale-1'), posCheckoutV2PaymentDocumentId('sale-1'));
  assert.equal(posCheckoutV2OutboxEventDocumentId('sale-1'), posCheckoutV2OutboxEventDocumentId('sale-1'));
  assert.notEqual(posCheckoutV2PaymentDocumentId('sale-1'), posCheckoutV2PaymentDocumentId('sale-2'));
});

test('outbox is one minimal durable POS_SALE_COMMITTED event starting PENDING', () => {
  const event = buildPosCheckoutV2OutboxEvent({
    eventId: 'event-1', saleId: 'sale-1', paymentId: 'payment-1', receiptNumber: 'KLA-2026-100001',
    tenantId: 'tenant-1', branchId: 'branch-1'
  });
  assert.equal(event.eventType, 'POS_SALE_COMMITTED');
  assert.equal(event.status, 'PENDING');
  assert.equal(event.attemptCount, 0);
  assert.deepEqual(event.payload, { saleId: 'sale-1', paymentId: 'payment-1' });
});

test('repository derives canonical payment from authoritative netTotal and writes payment/outbox inside the Batch 2 transaction', () => {
  const repository = readFileSync('src/services/pos-v2/posCheckoutV2Repository.ts', 'utf8');
  assert.match(repository, /authoritativeTotal: calculation\.netTotal/);
  assert.match(repository, /transaction\.set\(prepared\.paymentRef/);
  assert.match(repository, /transaction\.set\(prepared\.outboxRef/);
  assert.match(repository, /transaction\.set\(prepared\.saleRef/);
  assert.match(repository, /transaction\.set\(prepared\.attemptRef/);
  const paymentBuild = repository.indexOf('const payment = buildPosCheckoutV2Payment');
  const firstMutation = repository.indexOf("transaction.update(doc(db, 'product_batches'");
  assert.ok(paymentBuild >= 0 && firstMutation > paymentBuild, 'payment validation must fail before any transactional mutation is queued');
});

test('idempotent replay resolves the same canonical payment and outbox rather than creating new identities', () => {
  const repository = readFileSync('src/services/pos-v2/posCheckoutV2Repository.ts', 'utf8');
  assert.match(repository, /attempt\.paymentId \|\| prepared\.paymentId/);
  assert.match(repository, /attempt\.outboxEventId \|\| prepared\.outboxEventId/);
  assert.match(repository, /replayed: true/);
  assert.match(repository, /IDEMPOTENCY_CONFLICT/);
});

test('Batch 5 activates V2 only from Sales while keeping printing outside the V2 service', () => {
  const sales = readFileSync('src/pages/Sales.tsx', 'utf8');
  const service = readFileSync('src/services/pos-v2/posCheckoutV2Service.ts', 'utf8');
  assert.equal(sales.includes('executeCheckoutV2'), true);
  assert.equal(service.includes('printThermalReceipt'), false);
  assert.equal(service.includes('window.print'), false);
});
