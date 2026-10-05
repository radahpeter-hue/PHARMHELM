import assert from 'node:assert/strict';
import test from 'node:test';
import type { Sale } from '../src/types';
import { getPosV2RevisionReceiptPresentation } from '../src/services/pos-v2/posSaleRevisionV2Presentation';

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
