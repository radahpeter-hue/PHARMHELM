import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase/firestore';
import { procurementPostingIds } from '../src/services/procurementFinanceService';
import {
  dateInRange,
  calculateCreditSettlement,
  financialDate,
  normalizeCreditRecord,
  normalizeInvoiceRecord
} from '../src/services/financeRecordNormalization';

test('posting IDs are stable for GRN retries', () => {
  const first = procurementPostingIds('tenant-a', 'order/42');
  const second = procurementPostingIds('tenant-a', 'order/42');
  assert.deepEqual(first, second);
  assert.equal(first.invoiceId.includes('/'), false);
  assert.notEqual(first.invoiceId, procurementPostingIds('tenant-a', 'order-43').invoiceId);
});

test('credit settlement supports partial and full payment and blocks overpayment', () => {
  assert.deepEqual(calculateCreditSettlement(8000000, 3000000), { remainingAfter: 5000000, status: 'partial' });
  assert.deepEqual(calculateCreditSettlement(5000000, 5000000), { remainingAfter: 0, status: 'paid' });
  assert.throws(() => calculateCreditSettlement(5000000, 5000001), /exceeds/);
});

test('legacy Procurement invoice schema is normalized for Finance', () => {
  const invoice = normalizeInvoiceRecord('legacy-invoice', {
    tenantId: 'tenant-a', branch_id: 'branch-a', branch_name: 'Kampala',
    supplier_name: 'Supplier One', invoice_number: 'SUP-101', grn_number: 'GRN-101',
    amount: 8000000, status: 'Unpaid', created_at: '2026-09-01T08:00:00.000Z'
  });
  assert.equal(invoice.invoiceRef, 'SUP-101');
  assert.equal(invoice.branchId, 'branch-a');
  assert.equal(invoice.invoiceValue, 8000000);
  assert.equal(invoice.paymentStatus, 'credit');
  assert.equal(invoice.creditBalance, 8000000);
});

test('legacy credit schema is visible and retains the full opening balance', () => {
  const credit = normalizeCreditRecord('legacy-credit', {
    invoiceNumber: 'SUP-101', amount: 8000000, balance: 8000000,
    status: 'unpaid', createdAt: '2026-09-01T08:00:00.000Z'
  });
  assert.equal(credit.invoiceRef, 'SUP-101');
  assert.equal(credit.originalCreditAmount, 8000000);
  assert.equal(credit.remainingCreditBalance, 8000000);
  assert.equal(credit.status, 'outstanding');
});

test('date filters accept native Timestamp and legacy ISO strings', () => {
  const timestamp = Timestamp.fromDate(new Date('2026-09-01T10:00:00.000Z'));
  assert.equal(dateInRange(timestamp, '2026-09-01', '2026-09-01'), true);
  assert.equal(dateInRange('2026-09-01T10:00:00.000Z', '2026-09-01', '2026-09-01'), true);
  assert.equal(financialDate(timestamp)?.toISOString(), '2026-09-01T10:00:00.000Z');
});
