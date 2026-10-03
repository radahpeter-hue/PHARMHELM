import test from 'node:test';
import assert from 'node:assert/strict';
import { getPosV2ReceiptRevisionUiDecision } from '../src/services/pos-v2/posSaleRevisionV2UiPolicy';

function sale(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sale-1',
    tenantId: 'tenant-a',
    branchId: 'branch-a',
    receiptNumber: 'MSK-2026-111111',
    timestamp: '2026-10-01T08:00:00.000Z',
    items: [],
    subtotal: 100,
    tax: 0,
    total: 100,
    paymentMethod: 'cash',
    cashierId: 'cashier-1',
    status: 'completed',
    engineVersion: 2,
    ...overrides
  } as any;
}

test('eligible original V2 receipt exposes a revise action inside the 72-hour window', () => {
  const result = getPosV2ReceiptRevisionUiDecision(sale(), {
    canOperatePos: true,
    now: new Date('2026-10-02T08:00:00.000Z')
  });
  assert.equal(result.state, 'ELIGIBLE');
  assert.equal(result.canRevise, true);
  assert.equal(result.showReviseAction, true);
  assert.ok((result.remainingMs || 0) > 0);
});

test('72-hour expiry is visible but cannot be bypassed from the ledger', () => {
  const result = getPosV2ReceiptRevisionUiDecision(sale(), {
    canOperatePos: true,
    now: new Date('2026-10-04T08:00:00.001Z')
  });
  assert.equal(result.state, 'WINDOW_EXPIRED');
  assert.equal(result.canRevise, false);
  assert.equal(result.showReviseAction, true);
  assert.match(result.message, /72-hour/i);
});

test('lack of POS operating permission disables an otherwise eligible revision', () => {
  const result = getPosV2ReceiptRevisionUiDecision(sale(), {
    canOperatePos: false,
    now: new Date('2026-10-02T08:00:00.000Z')
  });
  assert.equal(result.state, 'NO_PERMISSION');
  assert.equal(result.canRevise, false);
  assert.equal(result.showReviseAction, true);
});

test('in-progress revision never exposes a second revision', () => {
  const result = getPosV2ReceiptRevisionUiDecision(sale({
    revisionId: 'revision-1',
    revisionLocked: true,
    revisionLifecycle: 'REPLACEMENT_PENDING',
    pendingReplacementSaleId: 'sale-replacement'
  }), { canOperatePos: true });
  assert.equal(result.state, 'REVISION_IN_PROGRESS');
  assert.equal(result.canRevise, false);
  assert.equal(result.replacementSaleId, 'sale-replacement');
});

test('completed original receipt points to its canonical replacement and cannot be revised again', () => {
  const result = getPosV2ReceiptRevisionUiDecision(sale({
    revisionId: 'revision-1',
    revisionLocked: true,
    revisionLifecycle: 'COMPLETED',
    supersededBySaleId: 'sale-replacement'
  }), { canOperatePos: true });
  assert.equal(result.state, 'ORIGINAL_REVISED');
  assert.equal(result.canRevise, false);
  assert.equal(result.replacementSaleId, 'sale-replacement');
});

test('replacement receipt is identified explicitly and cannot be revised again', () => {
  const result = getPosV2ReceiptRevisionUiDecision(sale({
    id: 'sale-replacement',
    isRevisionReplacement: true,
    revisionId: 'revision-1',
    revisionOfSaleId: 'sale-original'
  }), { canOperatePos: true });
  assert.equal(result.state, 'REPLACEMENT_RECEIPT');
  assert.equal(result.canRevise, false);
  assert.equal(result.originalSaleId, 'sale-original');
});

test('legacy receipts stay outside the V2 revision action', () => {
  const result = getPosV2ReceiptRevisionUiDecision(sale({ engineVersion: 1 }), { canOperatePos: true });
  assert.equal(result.state, 'NOT_V2');
  assert.equal(result.showReviseAction, false);
});
