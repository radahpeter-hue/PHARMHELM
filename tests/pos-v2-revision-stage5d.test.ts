import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = await import('../scripts/pos-v2-revision-worker-core.mjs');
const revisionWorker = readFileSync('scripts/process-pos-v2-revisions.mjs', 'utf8');
const normalWorker = readFileSync('scripts/process-pos-v2-outbox.mjs', 'utf8');

const request = {
  requestId: 'revision_request_1',
  requestType: 'POS_SALE_REVISION_REQUESTED',
  revisionId: 'revision_1',
  engineVersion: 2,
  payloadVersion: 1,
  status: 'PENDING',
  tenantId: 'tenant_1',
  branchId: 'branch_1',
  originalSaleId: 'sale_1',
  originalReceiptNumber: 'R-1001',
  requestedBy: 'manager_1',
  requestedByName: 'Branch Manager',
  reason: 'Quantity entered incorrectly'
};

const sale = {
  id: 'sale_1',
  tenantId: 'tenant_1',
  branchId: 'branch_1',
  receiptNumber: 'R-1001',
  engineVersion: 2,
  status: 'completed',
  totalAmount: 15000,
  canonicalPaymentId: 'pay_1',
  transactionOutboxEventId: 'outbox_1'
};

const payment = {
  paymentId: 'pay_1',
  saleId: 'sale_1',
  tenantId: 'tenant_1',
  branchId: 'branch_1',
  receiptNumber: 'R-1001',
  engineVersion: 2,
  amount: 15000
};

const outbox = {
  eventId: 'outbox_1',
  eventType: 'POS_SALE_COMMITTED',
  saleId: 'sale_1',
  paymentId: 'pay_1',
  tenantId: 'tenant_1',
  branchId: 'branch_1',
  receiptNumber: 'R-1001',
  engineVersion: 2,
  status: 'PROCESSED'
};

test('expired worker retry may resume only the same REVERSAL_PENDING revision lock', () => {
  const lockedSale = {
    ...sale,
    revisionLocked: true,
    revisionId: 'revision_1',
    revisionLifecycle: 'REVERSAL_PENDING'
  };
  assert.equal(core.validateRevisionRequest({ request, sale: lockedSale, payment, outbox, resume: true }), true);
  assert.throws(
    () => core.validateRevisionRequest({ request: { ...request, revisionId: 'revision_2' }, sale: lockedSale, payment, outbox, resume: true }),
    /already locked/
  );
  assert.throws(
    () => core.validateRevisionRequest({ request, sale: { ...lockedSale, supersededBySaleId: 'replacement_1' }, payment, outbox, resume: true }),
    /already locked/
  );
});

test('Stage 5D revision worker wires exact inventory restoration without changing normal sale worker routing', () => {
  assert.match(revisionWorker, /buildRevisionInventoryRestores/);
  assert.match(revisionWorker, /assertLiveBatchMatchesRestore/);
  assert.match(revisionWorker, /assertLiveProductCanRestore/);
  assert.match(revisionWorker, /INVENTORY_REVERSAL_EVENT_TYPE/);
  assert.match(revisionWorker, /tx\.create\(db\.collection\('inventoryMovementEvents'\)/);
  assert.match(revisionWorker, /reversalOfEventId/);
  assert.match(normalWorker, /eventType !== 'POS_SALE_COMMITTED'/);
  assert.doesNotMatch(normalWorker, /POS_SALE_REVISION_REQUESTED/);
});

test('inventory reversal is idempotent and fails closed on partial reversal evidence', () => {
  assert.match(revisionWorker, /existingCount === reversalEventSnaps\.length/);
  assert.match(revisionWorker, /Partial inventory reversal detected\. Manual review required/);
  assert.match(revisionWorker, /Inventory reversal event identity conflict\. Manual review required/);
});

test('Stage 5D reverses consumption by compensating the existing daily summary, not by deleting history', () => {
  assert.match(revisionWorker, /consumptionSummaryId/);
  assert.match(revisionWorker, /ordinaryUnitsSold = numberValue\(summary\.ordinaryUnitsSold\) - restore\.baseQuantity/);
  assert.match(revisionWorker, /validConsumptionUnits = numberValue\(summary\.validConsumptionUnits\) - restore\.baseQuantity/);
  assert.match(revisionWorker, /exceptionalUnits = numberValue\(summary\.exceptionalUnits\) - restore\.baseQuantity/);
  assert.doesNotMatch(revisionWorker, /\.delete\(/);
});

test('Stage 5D welfare reversal preserves records and compensates beneficiary balances', () => {
  assert.match(revisionWorker, /welfare_spent: Math\.max\(0, nextSpent\)/);
  assert.match(revisionWorker, /welfare_used_ytd: Math\.max\(0, nextYtd\)/);
  assert.match(revisionWorker, /status: 'reversed'/);
  assert.match(revisionWorker, /reversalRevisionId: revisionId/);
  assert.match(revisionWorker, /welfarePostingStatus: 'reversed'/);
});

test('institutional credit reversal fails closed if the receivable has already been settled or adjusted', () => {
  assert.match(revisionWorker, /Math\.abs\(numberValue\(receivable\.outstanding_ugx\) - amount\) > EPSILON/);
  assert.match(revisionWorker, /already been settled or adjusted\. Manual review required before revision/);
  assert.match(revisionWorker, /outstanding_ugx: 0/);
});

test('quotation compensation only reopens the quotation that belongs to the original sale', () => {
  assert.match(revisionWorker, /quotation\.status !== 'Converted'/);
  assert.match(revisionWorker, /clean\(quotation\.convertedReceiptId\) !== sale\.id/);
  assert.match(revisionWorker, /status: 'Draft'/);
  assert.match(revisionWorker, /quotationConversionStatus: 'pending'/);
});

test('original sale remains completed while reversal lifecycle reaches REVERSAL_COMPLETE', () => {
  assert.match(revisionWorker, /revisionLifecycle: 'REVERSAL_COMPLETE'/);
  assert.match(revisionWorker, /status: 'REVERSAL_COMPLETE'/);
  assert.doesNotMatch(revisionWorker, /status:\s*'revised'/);
  assert.doesNotMatch(revisionWorker, /status:\s*'voided'/);
});
