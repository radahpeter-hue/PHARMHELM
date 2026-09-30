import fs from 'node:fs';

const replaceRequired = (path, from, to, label) => {
  const source = fs.readFileSync(path, 'utf8');
  if (!source.includes(from)) throw new Error(`Missing patch anchor: ${label} in ${path}`);
  fs.writeFileSync(path, source.replace(from, to));
};

fs.writeFileSync('src/utils/salePresentation.ts', `import type { Sale, Staff } from '../types';

export const getReceiptLedgerReference = (sale: Sale): string => {
  const receiptNumber = String(sale.receiptNumber || '').trim();
  if (receiptNumber) return receiptNumber;
  const suffix = String(sale.id || '').slice(-8).toUpperCase();
  return suffix ? \`REF-\${suffix}\` : 'Reference unavailable';
};

export const getSaleSystemReference = (sale: Sale): string => {
  const suffix = String(sale.id || '').trim().slice(-8).toUpperCase();
  return suffix ? \`REF-\${suffix}\` : 'Reference unavailable';
};

export const resolveSaleOperatorName = (sale: Sale, staff: Staff[]): string => {
  const operatorId = String(sale.servedBy || (sale as Sale & { operatorUid?: string }).operatorUid || '').trim();
  if (!operatorId) return 'Operator';
  const matched = staff.find(member => [member.uid, member.id, member.legacyStaffId]
    .filter(Boolean)
    .some(identifier => String(identifier).trim() === operatorId));
  if (!matched) return 'Operator';
  return [matched.displayName, matched.full_name, matched.fullName, matched.username]
    .map(value => String(value || '').trim())
    .find(Boolean) || 'Operator';
};

export const getSaleIdentityLabel = (sale: Sale): string => {
  const institutionName = String(sale.institutionName || '').trim();
  if (institutionName) return institutionName;
  const patientName = String(sale.patientName || '').trim();
  if (patientName) return patientName;
  return sale.context === 'walk-in' ? 'Anonymous' : 'Identity not recorded';
};

export const matchesReceiptLedgerSearch = (sale: Sale, searchTerm: string): boolean => {
  const query = searchTerm.trim().toLowerCase();
  if (!query) return true;
  return [sale.receiptNumber, sale.patientName, sale.institutionName]
    .some(value => String(value || '').toLowerCase().includes(query));
};
`);

replaceRequired('src/pages/Sales.tsx',
  "import { getReceiptLedgerReference, getSaleIdentityLabel, matchesReceiptLedgerSearch } from '../utils/salePresentation';",
  "import { getReceiptLedgerReference, getSaleIdentityLabel, getSaleSystemReference, matchesReceiptLedgerSearch, resolveSaleOperatorName } from '../utils/salePresentation';",
  'sale presentation imports');

replaceRequired('src/pages/Sales.tsx',
  '<h3 className="text-lg font-bold text-zinc-900">Sale Details</h3>\n                <span className="text-xs font-mono text-zinc-400">ID: {selectedSale.id}</span>',
  '<h3 className="text-lg font-bold text-zinc-900">Sale Details</h3>\n                <span className="text-xs font-bold text-zinc-600">Receipt Number: {getReceiptLedgerReference(selectedSale)}</span>\n                <span className="text-[10px] font-mono text-zinc-400">System Reference: {getSaleSystemReference(selectedSale)}</span>',
  'sale details identity');

replaceRequired('src/pages/Sales.tsx',
  "const cashier = staff.find(s => s.uid === selectedSale.servedBy)?.displayName || staff.find(s => s.id === selectedSale.servedBy)?.displayName || selectedSale.servedBy || 'Operator';",
  'const cashier = resolveSaleOperatorName(selectedSale, staff);',
  'thermal seller');

replaceRequired('src/pages/Sales.tsx',
  '          receiptId={selectedA4ReceiptId}\n          isOpen={showA4InvoiceModal}',
  '          receiptId={selectedA4ReceiptId}\n          isOpen={showA4InvoiceModal}\n          staff={staff}',
  'A4 staff prop');

replaceRequired('src/components/sales/A4InvoiceTemplate.tsx',
  "import { Sale } from '../../types';",
  "import { Sale, Staff } from '../../types';\nimport { resolveSaleOperatorName } from '../../utils/salePresentation';",
  'A4 imports');
replaceRequired('src/components/sales/A4InvoiceTemplate.tsx', '  activeBranch: any;\n  systemSettings: any;', '  activeBranch: any;\n  staff: Staff[];\n  systemSettings: any;', 'A4 props');
replaceRequired('src/components/sales/A4InvoiceTemplate.tsx', '  activeBranch,\n  systemSettings', '  activeBranch,\n  staff,\n  systemSettings', 'A4 destructuring');
replaceRequired('src/components/sales/A4InvoiceTemplate.tsx', '  if (!receipt) return null;\n\n  const brandCompanyName', "  if (!receipt) return null;\n\n  const sellerName = resolveSaleOperatorName(receipt, staff);\n  const brandCompanyName", 'A4 seller resolver');
replaceRequired('src/components/sales/A4InvoiceTemplate.tsx', '        receipt,\n        branchName: resolvedBranchName,', '        receipt,\n        branchName: resolvedBranchName,\n        sellerName,', 'A4 PDF seller');
replaceRequired('src/components/sales/A4InvoiceTemplate.tsx', '<p className="text-zinc-500">Branch: <span className="font-bold text-zinc-900">{resolvedBranchName}</span></p>', '<p className="text-zinc-500">Branch: <span className="font-bold text-zinc-900">{resolvedBranchName}</span></p>\n                  <p className="text-zinc-500">Served By: <span className="font-bold text-zinc-900">{sellerName}</span></p>', 'A4 served by');

replaceRequired('src/services/invoicePdfExportService.ts', '  branchName: string;\n  branding: InvoicePdfBranding;', '  branchName: string;\n  sellerName: string;\n  branding: InvoicePdfBranding;', 'PDF input');
replaceRequired('src/services/invoicePdfExportService.ts', 'export const exportInvoicePdf = ({ receipt, branchName, branding }: InvoicePdfInput) => {', 'export const exportInvoicePdf = ({ receipt, branchName, sellerName, branding }: InvoicePdfInput) => {', 'PDF destructuring');
replaceRequired('src/services/invoicePdfExportService.ts', "  pdf.text(`Branch: ${clean(branchName, 'Branch not available')}`, pageWidth - margin, y + 13, { align: 'right' });\n  y += 21;", "  pdf.text(`Branch: ${clean(branchName, 'Branch not available')}`, pageWidth - margin, y + 13, { align: 'right' });\n  pdf.text(`Served By: ${clean(sellerName, 'Operator')}`, pageWidth - margin, y + 17, { align: 'right' });\n  y += 25;", 'PDF served by');

fs.writeFileSync('tests/sale-presentation.test.ts', `import test from 'node:test';
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
  assert.match(sales, /resolveSaleOperatorName\(selectedSale, staff\)/);
  assert.match(sales, /Receipt Number:/);
  assert.match(a4, /Served By:/);
  assert.match(pdf, /Served By:/);
});
`);

fs.writeFileSync('docs/POS_V2_PHASE4_RECEIPT_INTEGRITY_REPORT.md', `# POS V2 Phase 4 Receipt Integrity Report

This repair is presentation-only. It restores the human-readable receipt number as the primary Sale Details identity and resolves the original seller name consistently for thermal reprints, A4 invoice preview/print and downloaded PDF.

Protected POS V2 checkout, FEFO, stock, payment, Finance, Firestore rules and historical sale records are unchanged.
`);

console.log('Phase 4 receipt-integrity patch applied successfully.');
