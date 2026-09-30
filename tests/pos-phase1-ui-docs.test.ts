import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getReceiptLedgerReference, getSaleIdentityLabel, matchesReceiptLedgerSearch } from '../src/utils/salePresentation';

const salesSource = readFileSync(new URL('../src/pages/Sales.tsx', import.meta.url), 'utf8');
const invoiceSource = readFileSync(new URL('../src/components/sales/A4InvoiceTemplate.tsx', import.meta.url), 'utf8');
const invoicePdfSource = readFileSync(new URL('../src/services/invoicePdfExportService.ts', import.meta.url), 'utf8');

const sale = (overrides: Record<string, unknown> = {}) => ({
  id: 'V2SALE_Z_internal_12345678',
  receiptNumber: 'BR-3QLNF-2026-000123',
  context: 'walk-in',
  items: [],
  subtotal: 0,
  total: 0,
  totalAmount: 0,
  discountAmount: 0,
  paymentMethod: 'cash',
  timestamp: new Date().toISOString(),
  status: 'completed',
  ...overrides
}) as any;

test('Receipt Ledger displays receiptNumber as the receipt reference', () => {
  assert.equal(getReceiptLedgerReference(sale()), 'BR-3QLNF-2026-000123');
  assert.ok(salesSource.includes('{getReceiptLedgerReference(sale)}'));
});

test('Receipt Ledger fallback is readable and does not expose the V2 prefix', () => {
  assert.equal(getReceiptLedgerReference(sale({ receiptNumber: '' })), 'REF-12345678');
});

test('Institutional sale displays institutionName first', () => {
  assert.equal(getSaleIdentityLabel(sale({ context: 'institutional', institutionName: 'Mulago Hospital', patientName: 'Patient A' })), 'Mulago Hospital');
});

test('Named patient sale displays patientName', () => {
  assert.equal(getSaleIdentityLabel(sale({ patientName: 'Jane Doe' })), 'Jane Doe');
});

test('Anonymous walk-in displays Anonymous', () => {
  assert.equal(getSaleIdentityLabel(sale({ patientName: null, institutionName: null })), 'Anonymous');
});

test('Non-walk-in without an identity shows the missing identity warning', () => {
  assert.equal(getSaleIdentityLabel(sale({ context: 'telepharmacy', patientName: null, institutionName: null })), 'Identity not recorded');
});

test('Receipt Ledger search matches receiptNumber', () => {
  assert.equal(matchesReceiptLedgerSearch(sale(), '000123'), true);
});

test('Receipt Ledger search matches institutionName', () => {
  assert.equal(matchesReceiptLedgerSearch(sale({ institutionName: 'Mengo Hospital' }), 'mengo'), true);
});

test('Receipt Ledger search matches patientName', () => {
  assert.equal(matchesReceiptLedgerSearch(sale({ patientName: 'Peter Kato' }), 'kato'), true);
});

test('A4 invoice resolves correct branch and never uses false Main Store fallback', () => {
  assert.ok(invoiceSource.includes("getDoc(doc(db, 'branches', sale.branchId))"));
  assert.ok(invoiceSource.includes("activeBranch?.id === sale.branchId"));
  assert.ok(invoiceSource.includes("setResolvedBranchName(branchName || 'Branch not available')"));
  assert.equal(invoiceSource.includes("receipt.branchName || 'Main Store'"), false);
  assert.ok(invoiceSource.includes('{resolvedBranchName}'));
});

test('A4 PDF export uses deterministic jsPDF blob download and retains print fallback', () => {
  assert.ok(invoiceSource.includes("import { exportInvoicePdf } from '../../services/invoicePdfExportService'"));
  assert.ok(invoiceSource.includes('exportInvoicePdf({'));
  assert.ok(invoicePdfSource.includes("new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4'"));
  assert.ok(invoicePdfSource.includes("pdf.output('blob')"));
  assert.ok(invoicePdfSource.includes('URL.createObjectURL(blob)'));
  assert.ok(invoicePdfSource.includes("anchor.download = filename"));
  assert.ok(invoiceSource.includes('You can still use Print A4'));
  assert.equal(invoicePdfSource.includes("from 'html2canvas'"), false);
});

test('Institutional desktop layout retains an independently scrollable product region', () => {
  assert.ok(salesSource.includes('lg:max-h-[48%] lg:overflow-y-auto custom-scrollbar'));
  assert.ok(salesSource.includes('flex-1 min-h-0 bg-white rounded-3xl'));
  assert.ok(salesSource.includes('min-h-[250px] lg:min-h-0'));
});
