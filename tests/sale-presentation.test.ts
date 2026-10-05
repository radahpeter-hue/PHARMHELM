import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Sale, Staff } from '../src/types';
import { getReceiptLedgerReference, getSaleSystemReference, resolveSaleOperatorName } from '../src/utils/salePresentation';

const sale = (overrides: Partial<Sale> = {}) => ({ id: 'v2sale_example_c3517282', receiptNumber: 'BR-3QLNF-2026-558545', servedBy: 'kalebu-uid', context: 'walk-in', ...overrides } as Sale);
const member = (overrides: Partial<Staff> = {}) => ({ id: 'staff-doc', uid: 'kalebu-uid', legacyStaffId: null, tenantId: 't1', full_name: 'Kalebu Francis', username: '@k.francis', ...overrides } as Staff);

test('receipt identity prefers human-readable receipt number', () => {
  assert.equal(getReceiptLedgerReference(sale()), 'BR-3QLNF-2026-558545');
  assert.equal(getSaleSystemReference(sale()), 'REF-C3517282');
});

test('seller resolver uses original UID and readable staff name', () => {
  assert.equal(resolveSaleOperatorName(sale(), [member()]), 'Kalebu Francis');
  assert.equal(resolveSaleOperatorName(sale(), [member({ displayName: 'Kalebu F.' })]), 'Kalebu F.');
});

test('seller resolver supports legacy ID and does not expose unresolved UID', () => {
  assert.equal(resolveSaleOperatorName(sale({ servedBy: 'legacy-1' }), [member({ uid: 'other', legacyStaffId: 'legacy-1' })]), 'Kalebu Francis');
  assert.equal(resolveSaleOperatorName(sale({ servedBy: 'opaque-firebase-uid' }), []), 'Operator');
});

test('presentation consumers use the shared resolver', () => {
  const sales = readFileSync('src/pages/Sales.tsx', 'utf8');
  const a4 = readFileSync('src/components/sales/A4InvoiceTemplate.tsx', 'utf8');
  const pdf = readFileSync('src/services/invoicePdfExportService.ts', 'utf8');
  assert.ok(sales.includes('resolveSaleOperatorName(selectedSale, staff)'));
  assert.ok(sales.includes('Receipt Number: {getReceiptLedgerReference(selectedSale)}'));
  assert.ok(a4.includes("operatorLabel"));
  assert.ok(a4.includes(": 'Served By'"));
  assert.ok(pdf.includes("operatorLabel"));
  assert.ok(pdf.includes(": 'Served By'"));
});
