import test from 'node:test';
import assert from 'node:assert/strict';
import type { Sale } from '../src/types';
import { buildPosV2RevisionPlan } from '../src/services/pos-v2/posSaleRevisionV2Planner';
import {
  POS_V2_REVERSAL_EVENT_TYPE,
  buildPosV2RevisionEnvelope,
  buildPosV2RevisionIdentifiers
} from '../src/services/pos-v2/posSaleRevisionV2Envelope';

const originalSale = {
  id: 'sale-v2-001',
  tenantId: 'tenant-1',
  branchId: 'branch-masaka',
  receiptNumber: 'MSK-2026-000123',
  timestamp: '2026-09-30T08:00:00.000Z',
  engineVersion: 2,
  status: 'completed',
  cashierId: 'seller-1',
  items: [
    { productId: 'p1', productName: 'Amoxicillin', quantity: 2, unitPrice: 1000, actualUnitPrice: 1000, lineTotal: 2000 }
  ],
  subtotal: 2000,
  tax: 0,
  total: 2000,
  totalAmount: 2000,
  paymentMethod: 'cash',
  context: 'walk-in'
} as Sale & any;

function plan() {
  return buildPosV2RevisionPlan({
    originalSale,
    revisedItems: [
      { productId: 'p1', productName: 'Amoxicillin', quantity: 3, unitPrice: 1000, actualUnitPrice: 1000, lineTotal: 3000 }
    ] as any,
    revisedTotal: 3000,
    paymentMethod: 'mtn_momo',
    reason: 'Quantity and payment method corrected',
    now: new Date('2026-10-01T08:00:00.000Z')
  });
}

test('revision identifiers are deterministic and sequence scoped', () => {
  const first = buildPosV2RevisionIdentifiers({ tenantId: 'tenant-1', originalSaleId: 'sale-v2-001', sequence: 1 });
  const replay = buildPosV2RevisionIdentifiers({ tenantId: 'tenant-1', originalSaleId: 'sale-v2-001', sequence: 1 });
  const second = buildPosV2RevisionIdentifiers({ tenantId: 'tenant-1', originalSaleId: 'sale-v2-001', sequence: 2 });
  assert.deepEqual(first, replay);
  assert.notEqual(first.revisionId, second.revisionId);
  assert.notEqual(first.replacementSaleId, second.replacementSaleId);
});

test('revision envelope preserves original identity and locks the original without inventing a new Sale.status', () => {
  const envelope = buildPosV2RevisionEnvelope({
    originalSale,
    plan: plan(),
    revisedItems: [
      { productId: 'p1', productName: 'Amoxicillin', quantity: 3, unitPrice: 1000, actualUnitPrice: 1000, lineTotal: 3000 }
    ] as any,
    actor: { uid: 'manager-1', name: 'Branch Manager', role: 'Branch Manager' }
  });

  assert.equal(envelope.revision.originalSaleId, originalSale.id);
  assert.equal(envelope.revision.originalReceiptNumber, originalSale.receiptNumber);
  assert.equal(envelope.revision.originalSellerId, 'seller-1');
  assert.equal(envelope.revision.originalTimestamp, originalSale.timestamp);
  assert.equal('status' in envelope.originalSalePatch, false);
  assert.equal(envelope.originalSalePatch.revisionLifecycle, 'REVERSAL_PENDING');
  assert.equal(envelope.originalSalePatch.revisionLocked, true);
  assert.equal(envelope.originalSalePatch.revisionId, envelope.identifiers.revisionId);
  assert.equal(envelope.originalSalePatch.pendingReplacementSaleId, envelope.identifiers.replacementSaleId);
  assert.equal(envelope.replacementSaleSeed.revisionOfSaleId, originalSale.id);
  assert.equal(envelope.replacementSaleSeed.originalReceiptNumber, originalSale.receiptNumber);
  assert.equal(envelope.replacementSaleSeed.engineVersion, 2);
});

test('revision envelope records actor, reason and monetary change for analytics', () => {
  const envelope = buildPosV2RevisionEnvelope({
    originalSale,
    plan: plan(),
    revisedItems: [
      { productId: 'p1', productName: 'Amoxicillin', quantity: 3, unitPrice: 1000, actualUnitPrice: 1000, lineTotal: 3000 }
    ] as any,
    actor: { uid: 'manager-1', name: 'Branch Manager', role: 'Branch Manager' }
  });

  assert.equal(envelope.revision.revisedById, 'manager-1');
  assert.equal(envelope.revision.revisedByName, 'Branch Manager');
  assert.equal(envelope.revision.reason, 'Quantity and payment method corrected');
  assert.equal(envelope.revision.originalTotal, 2000);
  assert.equal(envelope.revision.revisedTotal, 3000);
  assert.equal(envelope.revision.monetaryDelta, 1000);
  assert.equal(envelope.revision.adjustmentDirection, 'INCREASE');
  assert.ok(envelope.revision.changeTypes.includes('QUANTITY_CHANGED'));
  assert.ok(envelope.revision.changeTypes.includes('PAYMENT_METHOD_CHANGED'));
});

test('reversal outbox is explicit and cannot masquerade as a normal sale commit', () => {
  const envelope = buildPosV2RevisionEnvelope({
    originalSale,
    plan: plan(),
    revisedItems: [
      { productId: 'p1', productName: 'Amoxicillin', quantity: 3, unitPrice: 1000, actualUnitPrice: 1000, lineTotal: 3000 }
    ] as any,
    actor: { uid: 'manager-1', name: 'Branch Manager' }
  });

  assert.equal(envelope.reversalOutbox.eventType, POS_V2_REVERSAL_EVENT_TYPE);
  assert.equal(envelope.reversalOutbox.eventType, 'POS_SALE_REVERSAL_REQUESTED');
  assert.notEqual(envelope.reversalOutbox.eventType, 'POS_SALE_COMMITTED');
  assert.equal(envelope.reversalOutbox.status, 'PENDING');
  assert.equal(envelope.reversalOutbox.saleId, originalSale.id);
  assert.equal(envelope.reversalOutbox.revisionId, envelope.identifiers.revisionId);
});

test('revision envelope fails closed on plan/sale mismatch and missing actor', () => {
  const validPlan = plan();
  assert.throws(() => buildPosV2RevisionEnvelope({
    originalSale: { ...originalSale, id: 'different-sale' } as any,
    plan: validPlan,
    revisedItems: originalSale.items,
    actor: { uid: 'manager-1', name: 'Branch Manager' }
  }), /does not belong/);

  assert.throws(() => buildPosV2RevisionEnvelope({
    originalSale,
    plan: validPlan,
    revisedItems: originalSale.items,
    actor: { uid: '', name: '' }
  }), /revision actor/);
});
