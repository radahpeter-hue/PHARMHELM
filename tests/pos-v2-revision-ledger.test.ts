import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { Sale, Staff } from '../src/types';
import { buildPosV2RevisionLedgerEntry } from '../src/services/pos-v2/posSaleRevisionV2Ledger';

const original: Sale = {
  id: 'sale-original', tenantId: 'tenant-1', branchId: 'branch-1', receiptNumber: 'MSK-001',
  timestamp: '2026-10-01T08:00:00.000Z', items: [], subtotal: 10000, tax: 0, total: 10000,
  totalAmount: 10000, paymentMethod: 'cash', cashierId: 'seller-1', servedBy: 'seller-1',
  status: 'completed', engineVersion: 2
};

const replacement: Sale = {
  ...original,
  id: 'sale-replacement', receiptNumber: 'MSK-002', total: 12000, totalAmount: 12000,
  cashierId: 'executor-1', servedBy: 'executor-1', isRevisionReplacement: true,
  revisionId: 'revision-1', revisionRequestId: 'request-1', revisionOfSaleId: original.id,
  originalReceiptNumber: original.receiptNumber
};

const staff = [
  { id: 'seller-1', uid: 'seller-1', displayName: 'Original Seller' },
  { id: 'executor-1', uid: 'executor-1', displayName: 'Replacement Executor' }
] as Staff[];

const request: Record<string, unknown> = {
  requestId: 'request-1', revisionId: 'revision-1', tenantId: 'tenant-1', branchId: 'branch-1',
  originalSaleId: 'sale-original', originalReceiptNumber: 'MSK-001', originalSellerId: 'seller-1',
  originalTimestamp: original.timestamp, requestedBy: 'editor-1', requestedByName: 'Revision Editor',
  requestedByRole: 'Branch Manager', reason: 'Correct the supplied quantity', replacementSaleId: 'sale-replacement',
  replacementReceiptNumber: 'MSK-002', originalTotal: 10000, revisedTotal: 12000, monetaryDelta: 2000,
  adjustmentDirection: 'INCREASE', itemChanges: [{ type: 'QUANTITY_CHANGED', productId: 'p1', productName: 'Item' }],
  before: { paymentMethod: 'cash', context: 'walk-in', patientId: null, institutionId: null, prescriberId: null, discountPercentage: 0 },
  after: { paymentMethod: 'card', context: 'walk-in', patientId: null, institutionId: null, prescriberId: null, discountPercentage: 0 },
  status: 'COMPLETED', replacementLifecycle: 'COMPLETED', createdAt: '2026-10-01T09:00:00.000Z',
  replacementCreatedAt: '2026-10-01T09:05:00.000Z', completedAt: '2026-10-01T09:10:00.000Z'
};

test('ledger projection preserves every permanent revision identity and monetary field', () => {
  const ledger = buildPosV2RevisionLedgerEntry({ request, originalSale: original, replacementSale: replacement, staff });
  assert.equal(ledger.revisionId, 'revision-1');
  assert.equal(ledger.requestId, 'request-1');
  assert.equal(ledger.originalSaleId, 'sale-original');
  assert.equal(ledger.originalReceiptNumber, 'MSK-001');
  assert.equal(ledger.replacementSaleId, 'sale-replacement');
  assert.equal(ledger.replacementReceiptNumber, 'MSK-002');
  assert.deepEqual(ledger.originalSeller, { id: 'seller-1', name: 'Original Seller' });
  assert.deepEqual(ledger.revisionEditor, { id: 'editor-1', name: 'Revision Editor', role: 'Branch Manager' });
  assert.deepEqual(ledger.replacementExecutor, { id: 'executor-1', name: 'Replacement Executor' });
  assert.equal(ledger.originalTotal, 10000);
  assert.equal(ledger.correctedTotal, 12000);
  assert.equal(ledger.monetaryDelta, 2000);
  assert.equal(ledger.adjustmentDirection, 'INCREASE');
  assert.equal(ledger.lifecycleStatus, 'COMPLETED');
});

test('ledger projection exposes item and contextual changes without mutating source evidence', () => {
  const ledger = buildPosV2RevisionLedgerEntry({ request, originalSale: original, replacementSale: replacement, staff });
  assert.equal(ledger.itemChanges.length, 1);
  assert.deepEqual(ledger.contextualChanges, [{ field: 'paymentMethod', before: 'cash', after: 'card' }]);
  ledger.itemChanges.push({ type: 'ITEM_ADDED', productId: 'p2', productName: 'Other' });
  assert.equal((request.itemChanges as unknown[]).length, 1);
});

test('ledger projection retains failure and manual-review evidence', () => {
  const ledger = buildPosV2RevisionLedgerEntry({
    request: { ...request, status: 'FAILED', replacementLifecycle: null, lastError: 'Replacement failed', requiresManualReview: true },
    originalSale: original,
    staff
  });
  assert.equal(ledger.lifecycleStatus, 'FAILED');
  assert.deepEqual(ledger.failure, { message: 'Replacement failed', requiresManualReview: true });
});

test('ledger projection fails closed on monetary or cross-branch linkage drift', () => {
  assert.throws(
    () => buildPosV2RevisionLedgerEntry({ request: { ...request, monetaryDelta: 999 }, originalSale: original }),
    /monetary evidence is inconsistent/i
  );
  assert.throws(
    () => buildPosV2RevisionLedgerEntry({ request, originalSale: { ...original, branchId: 'branch-other' } }),
    /crossed its canonical boundary/i
  );
  assert.throws(
    () => buildPosV2RevisionLedgerEntry({ request, originalSale: original, replacementSale: { ...replacement, revisionId: 'revision-other' } }),
    /replacement sale linkage is inconsistent/i
  );
});

test('ledger repository is read-only and always queries tenant plus branch for branch scope', () => {
  const source = readFileSync('src/services/pos-v2/posSaleRevisionV2LedgerRepository.ts', 'utf8');
  assert.match(source, /auth\.currentUser/);
  assert.match(source, /where\('tenantId', '==', clean\(scope\.tenantId\)\)/);
  assert.match(source, /scope\.kind === 'BRANCH'/);
  assert.match(source, /where\('branchId', '==', clean\(scope\.branchId\)\)/);
  assert.match(source, /collection\(db, 'pos_sale_revision_requests'\)/);
  assert.doesNotMatch(source, /addDoc|setDoc|updateDoc|deleteDoc|runTransaction|writeBatch/);
});
