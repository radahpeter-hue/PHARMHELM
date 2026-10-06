import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { Sale } from '../src/types';
import { findLinkedPosV2RevisionSale, getPosV2RevisionReceiptPresentation } from '../src/services/pos-v2/posSaleRevisionV2Presentation';
import { buildReceiptRevisionPlainText } from '../src/utils/receiptPrinting';

const sale = (overrides: Partial<Sale> = {}): Sale => ({
  id: 'sale-original',
  tenantId: 'tenant-1',
  branchId: 'branch-1',
  receiptNumber: 'MSK-2026-000001',
  timestamp: '2026-10-05T08:00:00.000Z',
  items: [],
  subtotal: 1000,
  tax: 0,
  total: 1000,
  totalAmount: 1000,
  paymentMethod: 'cash',
  cashierId: 'seller-1',
  servedBy: 'seller-1',
  status: 'completed',
  engineVersion: 2,
  ...overrides
});

const salesSource = readFileSync(new URL('../src/pages/Sales.tsx', import.meta.url), 'utf8');

test('standard receipt has no revision presentation', () => {
  const result = getPosV2RevisionReceiptPresentation(sale());
  assert.equal(result.kind, 'STANDARD');
  assert.equal(result.badgeLabel, null);
  assert.equal(result.linkedSaleId, null);
});

test('original receipt in progress retains editor metadata without changing seller identity', () => {
  const original = sale({
    revisionId: 'revision-1',
    revisionLifecycle: 'REPLACEMENT_PENDING',
    revisionRequestedBy: 'editor-1',
    revisionRequestedByName: 'Branch Manager',
    revisionReason: 'Correct the dispensed quantity',
    pendingReplacementSaleId: 'sale-corrected'
  });
  const result = getPosV2RevisionReceiptPresentation(original);
  assert.equal(result.kind, 'REVISION_IN_PROGRESS');
  assert.equal(result.editorName, 'Branch Manager');
  assert.equal(result.reason, 'Correct the dispensed quantity');
  assert.equal(original.servedBy, 'seller-1');
});

test('completed original is explicitly superseded and links to corrected receipt', () => {
  const result = getPosV2RevisionReceiptPresentation(sale({
    revisionId: 'revision-1',
    revisionLifecycle: 'COMPLETED',
    supersededBySaleId: 'sale-corrected',
    supersededByReceiptNumber: 'MSK-2026-000002'
  }));
  assert.equal(result.kind, 'ORIGINAL_SUPERSEDED');
  assert.equal(result.badgeLabel, 'REVISED · SUPERSEDED');
  assert.equal(result.linkedSaleId, 'sale-corrected');
  assert.equal(result.linkedReceiptNumber, 'MSK-2026-000002');
  assert.equal(result.linkedReceiptLabel, 'Corrected receipt');
});

test('replacement is explicitly corrected and links back to the original receipt', () => {
  const result = getPosV2RevisionReceiptPresentation(sale({
    id: 'sale-corrected',
    receiptNumber: 'MSK-2026-000002',
    servedBy: 'replacement-executor',
    isRevisionReplacement: true,
    revisionId: 'revision-1',
    revisionRequestId: 'request-1',
    revisionOfSaleId: 'sale-original',
    originalReceiptNumber: 'MSK-2026-000001'
  }));
  assert.equal(result.kind, 'CORRECTED_RECEIPT');
  assert.equal(result.documentTitle, 'CORRECTED RECEIPT');
  assert.equal(result.linkedSaleId, 'sale-original');
  assert.equal(result.linkedReceiptNumber, 'MSK-2026-000001');
  assert.equal(result.linkedReceiptLabel, 'Original receipt');
});

test('counterpart lookup stays inside the current tenant and branch ledger', () => {
  const original = sale({ supersededBySaleId: 'sale-corrected', supersededByReceiptNumber: 'MSK-2026-000002' });
  const wrongTenant = sale({ id: 'sale-corrected', tenantId: 'tenant-other' });
  const wrongBranch = sale({ id: 'sale-corrected', branchId: 'branch-other' });
  const corrected = sale({ id: 'sale-corrected', receiptNumber: 'MSK-2026-000002' });

  assert.equal(findLinkedPosV2RevisionSale(original, [wrongTenant, wrongBranch]), null);
  assert.equal(findLinkedPosV2RevisionSale(original, [wrongTenant, corrected]), corrected);
});

test('Receipt Ledger renders revision badges and opens only a resolved branch counterpart', () => {
  assert.match(salesSource, /getPosV2RevisionReceiptPresentation\(sale\)/);
  assert.match(salesSource, /findLinkedPosV2RevisionSale\(sale, sales\)/);
  assert.match(salesSource, /revisionPresentation\.badgeLabel/);
  assert.match(salesSource, /revisionPresentation\.linkedReceiptNumber/);
  assert.match(salesSource, /openLinkedRevisionReceipt\(sale\)/);
});

test('receipt details keep seller, editor and replacement executor as separate audit concepts', () => {
  assert.match(salesSource, /'Replacement executor'/);
  assert.match(salesSource, /'Original seller'/);
  assert.match(salesSource, /Revision editor/);
  assert.match(salesSource, /resolveSaleOperatorName\(selectedSale, staff\)/);
  assert.match(salesSource, /selectedRevisionPresentation\.editorName/);
  assert.match(salesSource, /Open \{selectedRevisionPresentation\.linkedReceiptLabel\}/);
  assert.doesNotMatch(salesSource, /selectedSale\.servedBy\s*=\s*selectedRevisionPresentation/);
});

test('thermal and shared text identify superseded and corrected receipts without changing operator identity', () => {
  const originalText = buildReceiptRevisionPlainText(sale({
    revisionId: 'revision-1',
    revisionLifecycle: 'COMPLETED',
    revisionRequestedByName: 'Revision Editor',
    revisionReason: 'Correct quantity',
    supersededBySaleId: 'sale-corrected',
    supersededByReceiptNumber: 'MSK-2026-000002'
  }), 'Original Seller');
  assert.match(originalText, /^SUPERSEDED RECEIPT/m);
  assert.match(originalText, /Original seller: Original Seller/);
  assert.match(originalText, /Corrected receipt: MSK-2026-000002/);
  assert.match(originalText, /Revision editor: Revision Editor/);
  assert.match(originalText, /Correction reason: Correct quantity/);

  const correctedText = buildReceiptRevisionPlainText(sale({
    id: 'sale-corrected',
    isRevisionReplacement: true,
    revisionId: 'revision-1',
    revisionRequestId: 'request-1',
    revisionOfSaleId: 'sale-original',
    originalReceiptNumber: 'MSK-2026-000001'
  }), 'Replacement Operator');
  assert.match(correctedText, /^CORRECTED RECEIPT/m);
  assert.match(correctedText, /Replacement executor: Replacement Operator/);
  assert.match(correctedText, /Original receipt: MSK-2026-000001/);
  assert.match(correctedText, /Request reference: request-1/);
});

test('reprint preview and thermal printer use the revision presentation contract', () => {
  const thermalSource = readFileSync(new URL('../src/utils/receiptPrinting.ts', import.meta.url), 'utf8');
  assert.match(thermalSource, /getPosV2RevisionReceiptPresentation\(sale\)/);
  assert.match(thermalSource, /revisionPresentation\.documentTitle/);
  assert.match(thermalSource, /revisionPresentation\.linkedReceiptNumber/);
  assert.match(salesSource, /buildReceiptRevisionPlainText\(selectedSale/);
  assert.match(salesSource, /selectedRevisionPresentation\.documentTitle/);
});

test('A4 screen, browser print and deterministic PDF carry revision identity and linkage', () => {
  const a4Source = readFileSync(new URL('../src/components/sales/A4InvoiceTemplate.tsx', import.meta.url), 'utf8');
  const pdfSource = readFileSync(new URL('../src/services/invoicePdfExportService.ts', import.meta.url), 'utf8');
  assert.match(a4Source, /getPosV2RevisionReceiptPresentation\(receipt\)/);
  assert.match(a4Source, /Revision Linkage/);
  assert.match(a4Source, /revisionPresentation\.linkedReceiptNumber/);
  assert.match(a4Source, /operatorLabel/);
  assert.match(pdfSource, /getPosV2RevisionReceiptPresentation\(receipt\)/);
  assert.match(pdfSource, /pdf\.text\(documentTitle/);
  assert.match(pdfSource, /REVISION LINKAGE/);
  assert.match(pdfSource, /revisionPresentation\.revisionRequestId/);
});
