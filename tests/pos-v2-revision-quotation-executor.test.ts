import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildQuotationReversal,
  quotationReversalId,
  validateQuotationOriginal
} from '../scripts/pos-v2-revision-quotation-core.mjs';

const executor = readFileSync('scripts/pos-v2-revision-quotation-executor.mjs', 'utf8');

function sale() {
  return {
    id: 'sale-1',
    engineVersion: 2,
    tenantId: 'tenant-1',
    branchId: 'branch-1',
    receiptNumber: 'MSK-2026-000123',
    sourceQuotationId: 'QUO-MSK-2026-0012',
    totalAmount: 125000
  };
}

function quotation() {
  return {
    tenantId: 'tenant-1',
    branchId: 'branch-1',
    status: 'Converted',
    convertedReceiptId: 'sale-1',
    convertedAt: '2026-10-01T09:00:00.000Z',
    convertedValue: 125000
  };
}

test('quotation reversal identity is deterministic and revision scoped', () => {
  const first = quotationReversalId({ revisionId: 'rev-1', quotationId: 'QUO-MSK-2026-0012' });
  const second = quotationReversalId({ revisionId: 'rev-1', quotationId: 'QUO-MSK-2026-0012' });
  const different = quotationReversalId({ revisionId: 'rev-2', quotationId: 'QUO-MSK-2026-0012' });
  assert.equal(first, second);
  assert.notEqual(first, different);
});

test('quotation reversal validates exact original conversion linkage and value', () => {
  assert.doesNotThrow(() => validateQuotationOriginal({ sale: sale(), quotation: quotation() }));
  assert.throws(() => validateQuotationOriginal({ sale: sale(), quotation: { ...quotation(), convertedReceiptId: 'other-sale' } }), /not linked/);
  assert.throws(() => validateQuotationOriginal({ sale: sale(), quotation: { ...quotation(), convertedValue: 100000 } }), /converted value conflicts/);
  assert.throws(() => validateQuotationOriginal({ sale: sale(), quotation: { ...quotation(), status: 'Draft' } }), /canonical Converted state/);
});

test('quotation reversal contract preserves prior conversion evidence while restoring Draft', () => {
  const result = buildQuotationReversal({
    sale: sale(),
    quotation: quotation(),
    revisionId: 'rev-1',
    requestedBy: 'uid-1',
    requestedByName: 'Editor One',
    reason: 'Incorrect quotation-linked receipt'
  });
  assert.equal(result.priorStatus, 'Converted');
  assert.equal(result.restoredStatus, 'Draft');
  assert.equal(result.priorConvertedReceiptId, 'sale-1');
  assert.equal(result.priorConvertedValue, 125000);
  assert.equal(result.quotationId, 'QUO-MSK-2026-0012');
});

test('quotation executor leaves an append-only reversal record and reopens the quotation atomically', () => {
  assert.match(executor, /collection\('pos_quotation_reversals'\)/);
  assert.match(executor, /tx\.create\(reversalRef,/);
  assert.match(executor, /status: 'Draft'/);
  assert.match(executor, /convertedReceiptId: null/);
  assert.match(executor, /convertedAt: null/);
  assert.match(executor, /convertedValue: null/);
  assert.match(executor, /quotationConversionStatus: 'reversed'/);
  assert.doesNotMatch(executor, /tx\.delete/);
});

test('quotation executor checks deterministic reversal history before validating the now-reopened quotation', () => {
  const reversalRead = executor.indexOf('if (reversalSnap.exists)');
  const originalValidation = executor.indexOf('validateQuotationOriginal({ sale: liveSale, quotation: liveQuotation })');
  assert.ok(reversalRead >= 0);
  assert.ok(originalValidation > reversalRead);
  assert.match(executor, /Quotation reversal history is partial or conflicting\. Manual review required\./);
});
