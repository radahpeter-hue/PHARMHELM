import fs from 'node:fs';

const replaceOnce = (path, from, to, label) => {
  const source = fs.readFileSync(path, 'utf8');
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`Patch anchor not found for ${label} in ${path}`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`Patch anchor is not unique for ${label} in ${path}`);
  fs.writeFileSync(path, source.slice(0, first) + to + source.slice(first + from.length));
};

// 1) Canonical sale presentation helpers.
{
  const path = 'src/utils/salePresentation.ts';
  const source = `import type { Sale, Staff } from '../types';\n\nexport const getReceiptLedgerReference = (sale: Sale): string => {\n  const receiptNumber = String(sale.receiptNumber || '').trim();\n  if (receiptNumber) return receiptNumber;\n  const suffix = String(sale.id || '').slice(-8).toUpperCase();\n  return suffix ? \`REF-\${suffix}\` : 'Reference unavailable';\n};\n\nexport const getSaleSystemReference = (sale: Sale): string => {\n  const suffix = String(sale.id || '').trim().slice(-8).toUpperCase();\n  return suffix ? \`REF-\${suffix}\` : 'Reference unavailable';\n};\n\nexport const resolveSaleOperatorName = (sale: Sale, staff: Staff[]): string => {\n  const operatorId = String(sale.servedBy || (sale as Sale & { operatorUid?: string }).operatorUid || '').trim();\n  if (!operatorId) return 'Operator';\n\n  const matched = staff.find(member =>\n    [member.uid, member.id, member.legacyStaffId]\n      .filter(Boolean)\n      .some(identifier => String(identifier).trim() === operatorId)\n  );\n\n  if (!matched) return 'Operator';\n\n  return [matched.displayName, matched.full_name, matched.fullName, matched.username]\n    .map(value => String(value || '').trim())\n    .find(Boolean) || 'Operator';\n};\n\nexport const getSaleIdentityLabel = (sale: Sale): string => {\n  const institutionName = String(sale.institutionName || '').trim();\n  if (institutionName) return institutionName;\n\n  const patientName = String(sale.patientName || '').trim();\n  if (patientName) return patientName;\n\n  return sale.context === 'walk-in' ? 'Anonymous' : 'Identity not recorded';\n};\n\nexport const matchesReceiptLedgerSearch = (sale: Sale, searchTerm: string): boolean => {\n  const query = searchTerm.trim().toLowerCase();\n  if (!query) return true;\n\n  return [sale.receiptNumber, sale.patientName, sale.institutionName]\n    .some(value => String(value || '').toLowerCase().includes(query));\n};\n`;
  fs.writeFileSync(path, source);
}

// 2) Sales drawer identity and thermal seller attribution.
replaceOnce(
  'src/pages/Sales.tsx',
  "import { getReceiptLedgerReference, getSaleIdentityLabel, matchesReceiptLedgerSearch } from '../utils/salePresentation';",
  "import { getReceiptLedgerReference, getSaleIdentityLabel, getSaleSystemReference, matchesReceiptLedgerSearch, resolveSaleOperatorName } from '../utils/salePresentation';",
  'Sales presentation imports'
);

replaceOnce(
  'src/pages/Sales.tsx',
  '<h3 className="text-lg font-bold text-zinc-900">Sale Details</h3>\n                <span className="text-xs font-mono text-zinc-400">ID: {selectedSale.id}</span>',
  '<h3 className="text-lg font-bold text-zinc-900">Sale Details</h3>\n                <span className="text-xs font-bold text-zinc-600">Receipt Number: {getReceiptLedgerReference(selectedSale)}</span>\n                <span className="text-[10px] font-mono text-zinc-400">System Reference: {getSaleSystemReference(selectedSale)}</span>',
  'Sale Details identity hierarchy'
);

replaceOnce(
  'src/pages/Sales.tsx',
  "const cashier = staff.find(s => s.uid === selectedSale.servedBy)?.displayName || staff.find(s => s.id === selectedSale.servedBy)?.displayName || selectedSale.servedBy || 'Operator';",
  'const cashier = resolveSaleOperatorName(selectedSale, staff);',
  'thermal reprint seller resolution'
);

replaceOnce(
  'src/pages/Sales.tsx',
  '          activeBranch={activeBranch}\n          systemSettings={systemSettings}',
  '          activeBranch={activeBranch}\n          staff={staff}\n          systemSettings={systemSettings}',
  'A4 invoice staff prop'
);

// 3) A4 invoice original seller attribution.
replaceOnce(
  'src/components/sales/A4InvoiceTemplate.tsx',
  "import { Sale } from '../../types';",
  "import { Sale, Staff } from '../../types';\nimport { resolveSaleOperatorName } from '../../utils/salePresentation';",
  'A4 imports'
);

replaceOnce(
  'src/components/sales/A4InvoiceTemplate.tsx',
  '  activeBranch: any;\n  systemSettings: any;',
  '  activeBranch: any;\n  staff: Staff[];\n  systemSettings: any;',
  'A4 props interface'
);

replaceOnce(
  'src/components/sales/A4InvoiceTemplate.tsx',
  '  activeBranch,\n  systemSettings',
  '  activeBranch,\n  staff,\n  systemSettings',
  'A4 props destructuring'
);

replaceOnce(
  'src/components/sales/A4InvoiceTemplate.tsx',
  '  if (!receipt) return null;\n\n  const brandCompanyName',
  "  if (!receipt) return null;\n\n  const sellerName = resolveSaleOperatorName(receipt, staff);\n  const brandCompanyName",
  'A4 seller resolution'
);

replaceOnce(
  'src/components/sales/A4InvoiceTemplate.tsx',
  '        receipt,\n        branchName: resolvedBranchName,',
  '        receipt,\n        branchName: resolvedBranchName,\n        sellerName,',
  'A4 PDF seller input'
);

replaceOnce(
  'src/components/sales/A4InvoiceTemplate.tsx',
  '<p className="text-zinc-500">Branch: <span className="font-bold text-zinc-900">{resolvedBranchName}</span></p>',
  '<p className="text-zinc-500">Branch: <span className="font-bold text-zinc-900">{resolvedBranchName}</span></p>\n                  <p className="text-zinc-500">Served By: <span className="font-bold text-zinc-900">{sellerName}</span></p>',
  'A4 visible seller attribution'
);

// 4) Downloaded PDF seller attribution.
replaceOnce(
  'src/services/invoicePdfExportService.ts',
  '  branchName: string;\n  branding: InvoicePdfBranding;',
  '  branchName: string;\n  sellerName: string;\n  branding: InvoicePdfBranding;',
  'PDF input seller'
);

replaceOnce(
  'src/services/invoicePdfExportService.ts',
  'export const exportInvoicePdf = ({ receipt, branchName, branding }: InvoicePdfInput) => {',
  'export const exportInvoicePdf = ({ receipt, branchName, sellerName, branding }: InvoicePdfInput) => {',
  'PDF function seller destructuring'
);

replaceOnce(
  'src/services/invoicePdfExportService.ts',
  "  pdf.text(`Branch: ${clean(branchName, 'Branch not available')}`, pageWidth - margin, y + 13, { align: 'right' });\n  y += 21;",
  "  pdf.text(`Branch: ${clean(branchName, 'Branch not available')}`, pageWidth - margin, y + 13, { align: 'right' });\n  pdf.text(`Served By: ${clean(sellerName, 'Operator')}`, pageWidth - margin, y + 17, { align: 'right' });\n  y += 25;",
  'PDF visible seller attribution'
);

// 5) Focused regression tests.
fs.writeFileSync('tests/sale-presentation.test.ts', `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\nimport type { Sale, Staff } from '../src/types';\nimport { getReceiptLedgerReference, getSaleSystemReference, resolveSaleOperatorName } from '../src/utils/salePresentation';\n\nconst sale = (overrides: Partial<Sale> = {}) => ({\n  id: 'v2sale_zehqTDcKyrDAOHKK3stJ_0f900a60-9546-48e8-9117-0710dae31461_c3517282',\n  receiptNumber: 'BR-3QLNF-2026-558545',\n  servedBy: 'kalebu-uid',\n  context: 'walk-in',\n  ...overrides,\n} as Sale);\n\nconst staff = (overrides: Partial<Staff> = {}) => ({\n  id: 'staff-doc',\n  uid: 'kalebu-uid',\n  legacyStaffId: null,\n  tenantId: 'tenant-1',\n  full_name: 'Kalebu Francis',\n  username: '@k.francis',\n  ...overrides,\n} as Staff);\n\ntest('human-readable receipt number remains the primary operational identity', () => {\n  assert.equal(getReceiptLedgerReference(sale()), 'BR-3QLNF-2026-558545');\n  assert.equal(getSaleSystemReference(sale()), 'REF-C3517282');\n});\n\ntest('operator resolver matches UID and uses full_name when displayName is absent', () => {\n  assert.equal(resolveSaleOperatorName(sale(), [staff()]), 'Kalebu Francis');\n});\n\ntest('operator resolver prefers displayName and supports legacy staff identifiers', () => {\n  assert.equal(resolveSaleOperatorName(sale(), [staff({ displayName: 'Kalebu F.' })]), 'Kalebu F.');\n  assert.equal(resolveSaleOperatorName(sale({ servedBy: 'legacy-44' }), [staff({ uid: 'different', legacyStaffId: 'legacy-44' })]), 'Kalebu Francis');\n});\n\ntest('unresolved operator never leaks a raw UID to an ordinary receipt', () => {\n  assert.equal(resolveSaleOperatorName(sale({ servedBy: 'opaque-firebase-uid' }), []), 'Operator');\n});\n\ntest('Sales and A4 invoice use the shared seller resolver and safe receipt identity', () => {\n  const salesSource = readFileSync('src/pages/Sales.tsx', 'utf8');\n  const a4Source = readFileSync('src/components/sales/A4InvoiceTemplate.tsx', 'utf8');\n  const pdfSource = readFileSync('src/services/invoicePdfExportService.ts', 'utf8');\n  assert.match(salesSource, /Receipt Number: \\{getReceiptLedgerReference\\(selectedSale\\)\\}/);\n  assert.match(salesSource, /System Reference: \\{getSaleSystemReference\\(selectedSale\\)\\}/);\n  assert.match(salesSource, /resolveSaleOperatorName\\(selectedSale, staff\\)/);\n  assert.match(a4Source, /Served By:/);\n  assert.match(pdfSource, /Served By:/);\n});\n`);

// 6) Phase report.
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/POS_V2_PHASE4_RECEIPT_INTEGRITY_REPORT.md', `# POS V2 Phase 4 Receipt Integrity Report\n\n## Scope\nNarrow presentation repair only. No canonical sale, stock, FEFO, payment, Finance, Firestore-rule or POS V2 checkout-engine mutation is introduced.\n\n## Repairs\n- Sale Details now presents the human-readable receipt number as the primary transaction identity.\n- The opaque internal V2 sale document ID is reduced to a safe support reference suffix.\n- Thermal reprints resolve the original seller from the immutable sale operator identifier through the tenant staff registry.\n- Seller resolution supports UID, staff document ID and legacy staff ID matching, with display-name fallbacks.\n- Raw Firebase UIDs are no longer printed on ordinary customer receipts when a staff name cannot be resolved.\n- A4 invoice preview/print and downloaded PDF display the original seller.\n\n## Protected areas intentionally unchanged\n- src/services/pos-v2/posCheckoutV2Repository.ts\n- src/services/pos-v2/posCheckoutV2Calculator.ts\n- src/services/pos-v2/posCheckoutV2Service.ts\n- FEFO allocation services\n- stock mutation semantics\n- payment posting\n- Finance posting\n- Firestore rules\n- historical sale records\n\n## Validation\nRun:\n\n\`\`\`bash\nnpm test -- --test-name-pattern=\"receipt|operator|seller|identity\"\nnpm run typecheck\nnpm run build\n\`\`\`\n\nProduction validation remains manual and must verify receipt BR-3QLNF-2026-558545 at Masaka shows Kalebu Francis on thermal reprint and A4 output without creating any new sale, payment, stock or Finance posting.\n`);

console.log('Phase 4 receipt-integrity patch applied successfully.');
