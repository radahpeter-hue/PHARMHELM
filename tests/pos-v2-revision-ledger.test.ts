import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { Sale, Staff } from '../src/types';
import { buildPosV2RevisionLedgerEntry } from '../src/services/pos-v2/posSaleRevisionV2Ledger';
import {
  buildPosV2BranchRevisionAnalytics,
  buildPosV2GlobalRevisionAnalytics
} from '../src/services/pos-v2/posSaleRevisionV2Analytics';
import { canViewGlobalPosV2RevisionAnalytics } from '../src/services/pos-v2/posSaleRevisionV2AnalyticsAccess';
import { buildPosV2RevisionReportCsv, buildPosV2RevisionReportFilename } from '../src/services/pos-v2/posSaleRevisionV2ReportExport';

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

test('Sales exposes the immutable branch revision ledger without mutation controls', () => {
  const sales = readFileSync('src/pages/Sales.tsx', 'utf8');
  const component = readFileSync('src/components/sales/PosV2RevisionLedger.tsx', 'utf8');
  assert.match(sales, /setView\('revisions'\)/);
  assert.match(sales, /<PosV2RevisionLedger/);
  assert.match(component, /Immutable Revision Ledger/);
  assert.match(component, /Original seller/);
  assert.match(component, /Revision editor/);
  assert.match(component, /Replacement executor/);
  assert.match(component, /Item changes/);
  assert.match(component, /Contextual changes/);
  assert.match(component, /Manual review required/);
  assert.match(component, /buildPosV2BranchRevisionAnalytics/);
  assert.match(component, /Additions/);
  assert.match(component, /Deductions/);
  assert.match(component, /All lifecycle states/);
  assert.match(component, /type="date"/);
  assert.match(component, /Receipt, editor, seller, reason or revision/);
  assert.doesNotMatch(component, /Edit revision|Delete revision|updateDoc|deleteDoc/);
});

test('branch analytics calculate original, corrected, additions, deductions and net values', () => {
  const increase = buildPosV2RevisionLedgerEntry({ request, originalSale: original, replacementSale: replacement, staff });
  const decrease = buildPosV2RevisionLedgerEntry({
    request: {
      ...request,
      requestId: 'request-2', revisionId: 'revision-2', replacementSaleId: null, replacementReceiptNumber: null,
      revisedTotal: 7000, monetaryDelta: -3000, adjustmentDirection: 'DECREASE', status: 'FAILED', replacementLifecycle: null
    },
    originalSale: original,
    staff
  });
  const analytics = buildPosV2BranchRevisionAnalytics([increase, decrease], { tenantId: 'tenant-1', branchId: 'branch-1' });
  assert.equal(analytics.revisedReceiptCount, 2);
  assert.equal(analytics.completedRevisionCount, 1);
  assert.equal(analytics.failedRevisionCount, 1);
  assert.equal(analytics.originalValue, 20000);
  assert.equal(analytics.correctedValue, 19000);
  assert.equal(analytics.additions, 2000);
  assert.equal(analytics.deductions, 3000);
  assert.equal(analytics.netChange, -1000);
  assert.equal(analytics.rows[0].revisionEditor.name, 'Revision Editor');
  assert.equal(analytics.rows[0].originalSeller.name, 'Original Seller');
  assert.equal(analytics.rows[0].reason, 'Correct the supplied quantity');
});

test('branch analytics reject mixed tenant or branch evidence', () => {
  const ledger = buildPosV2RevisionLedgerEntry({ request, originalSale: original, replacementSale: replacement, staff });
  assert.throws(
    () => buildPosV2BranchRevisionAnalytics([{ ...ledger, branchId: 'branch-other' }], { tenantId: 'tenant-1', branchId: 'branch-1' }),
    /cannot combine cross-tenant or cross-branch evidence/i
  );
});

test('global analytics aggregate revisions by readable branch without losing tenant totals', () => {
  const branchOne = buildPosV2RevisionLedgerEntry({ request, originalSale: original, replacementSale: replacement, staff });
  const branchTwo = buildPosV2RevisionLedgerEntry({
    request: {
      ...request,
      requestId: 'request-2', revisionId: 'revision-2', branchId: 'branch-2',
      originalSaleId: 'sale-original-2', originalReceiptNumber: 'JIN-001', replacementSaleId: null,
      replacementReceiptNumber: null, revisedTotal: 8000, monetaryDelta: -2000,
      adjustmentDirection: 'DECREASE', status: 'FAILED', replacementLifecycle: null
    },
    originalSale: { ...original, id: 'sale-original-2', branchId: 'branch-2', receiptNumber: 'JIN-001' },
    staff
  });
  const analytics = buildPosV2GlobalRevisionAnalytics(
    [branchOne, branchTwo],
    { tenantId: 'tenant-1' },
    [
      { id: 'branch-1', tenantId: 'tenant-1', name: 'Masaka' },
      { id: 'branch-2', tenantId: 'tenant-1', name: 'Jinja' }
    ]
  );
  assert.equal(analytics.revisedReceiptCount, 2);
  assert.equal(analytics.completedRevisionCount, 1);
  assert.equal(analytics.failedRevisionCount, 1);
  assert.equal(analytics.originalValue, 20000);
  assert.equal(analytics.correctedValue, 20000);
  assert.equal(analytics.additions, 2000);
  assert.equal(analytics.deductions, 2000);
  assert.equal(analytics.netChange, 0);
  assert.deepEqual(analytics.branches.map(branch => branch.branchName), ['Jinja', 'Masaka']);
});

test('global analytics reject cross-tenant ledger or branch metadata', () => {
  const ledger = buildPosV2RevisionLedgerEntry({ request, originalSale: original, replacementSale: replacement, staff });
  assert.throws(
    () => buildPosV2GlobalRevisionAnalytics([{ ...ledger, tenantId: 'tenant-other' }], { tenantId: 'tenant-1' }),
    /cannot combine cross-tenant evidence/i
  );
  assert.throws(
    () => buildPosV2GlobalRevisionAnalytics([ledger], { tenantId: 'tenant-1' }, [{ id: 'branch-1', tenantId: 'tenant-other', name: 'Wrong' }]),
    /cannot resolve cross-tenant branches/i
  );
});

test('global revision analytics UI gate mirrors named management roles and rejects branch-only roles', () => {
  const profile = (role: string, secondaryRoles: string[] = [], roleRealmId?: string) => ({ role, secondaryRoles, roleRealmId });
  for (const role of ['owner', 'CEO', 'CEO / MD', 'admin', 'Finance Head', 'Finance Officer', 'Accountant', 'IT Head', 'IT Support Staff', 'QA Head', 'QA Manager']) {
    assert.equal(canViewGlobalPosV2RevisionAnalytics(profile(role), false), true, role);
  }
  for (const role of ['Branch Manager', 'QA Officer', 'Dispenser', 'cashier', 'pharmacist']) {
    assert.equal(canViewGlobalPosV2RevisionAnalytics(profile(role), true), false, role);
  }
  assert.equal(canViewGlobalPosV2RevisionAnalytics(profile('Custom Finance Reviewer', [], 'realm-1'), true), true);
  assert.equal(canViewGlobalPosV2RevisionAnalytics(profile('Custom Viewer', [], 'realm-2'), false), false);
  assert.equal(canViewGlobalPosV2RevisionAnalytics(profile('Dispenser', ['Finance Officer']), false), true);
});

test('Analytics presents the tenant-wide revision report only through the certified global gate', () => {
  const analyticsPage = readFileSync('src/pages/Analytics.tsx', 'utf8');
  const posAnalytics = readFileSync('src/components/analytics/POSAnalytics.tsx', 'utf8');
  const globalReport = readFileSync('src/components/analytics/PosV2GlobalRevisionAnalytics.tsx', 'utf8');
  assert.match(analyticsPage, /canViewGlobalPosV2RevisionAnalytics/);
  assert.match(analyticsPage, /<POSAnalytics isGlobalView=\{isGlobalView\}/);
  assert.match(posAnalytics, /isGlobalView && profile\?\.tenantId && profile\.uid/);
  assert.match(globalReport, /kind: 'GLOBAL'/);
  assert.match(globalReport, /Global POS V2 Revision Analytics/);
  assert.match(globalReport, /Original seller/);
  assert.match(globalReport, /Revision editor/);
  assert.doesNotMatch(globalReport, /addDoc|setDoc|updateDoc|deleteDoc|runTransaction|writeBatch/);
});

test('downloadable revision report preserves audit evidence and spreadsheet safety', () => {
  const ledger = buildPosV2RevisionLedgerEntry({
    request: { ...request, reason: '=malicious spreadsheet formula' },
    originalSale: original,
    replacementSale: replacement,
    staff
  });
  const report = buildPosV2RevisionReportCsv(
    [ledger],
    { kind: 'GLOBAL', tenantId: 'tenant-1' },
    [{ id: 'branch-1', tenantId: 'tenant-1', name: 'Masaka' }]
  );
  assert.match(report, /^\uFEFF"Revision ID"/);
  assert.match(report, /"MSK-001"/);
  assert.match(report, /"MSK-002"/);
  assert.match(report, /"Original Seller"/);
  assert.match(report, /"Revision Editor"/);
  assert.match(report, /"'=malicious spreadsheet formula"/);
  assert.match(report, /"Masaka"/);
  assert.equal(buildPosV2RevisionReportFilename({ kind: 'BRANCH', tenantId: 'tenant-1', branchId: 'branch-1' }, new Date('2026-10-06T00:00:00Z')), 'pos-v2-revision-report-branch-branch-1-2026-10-06.csv');
});

test('downloadable revision reports reject tenant and branch scope drift', () => {
  const ledger = buildPosV2RevisionLedgerEntry({ request, originalSale: original, replacementSale: replacement, staff });
  assert.throws(
    () => buildPosV2RevisionReportCsv([{ ...ledger, tenantId: 'tenant-other' }], { kind: 'GLOBAL', tenantId: 'tenant-1' }),
    /cross-tenant evidence/i
  );
  assert.throws(
    () => buildPosV2RevisionReportCsv([ledger], { kind: 'BRANCH', tenantId: 'tenant-1', branchId: 'branch-other' }),
    /cross-branch evidence/i
  );
});
