import { collection, doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import type { InventoryMovement, InventoryMovementEvent, ProductBatch } from '../types';
import { getBranchProductBatchRefs, logMovementAndAggregateInTx } from './consumptionService';

export function stockAdjustmentEventType(quantityDelta: number, reason: string): InventoryMovementEvent['eventType'] {
  if (quantityDelta > 0) return 'POSITIVE_ADJUSTMENT';
  if (/\b(?:return(?:ed|ing)?|quarantin\w*|recall\w*|suspect\w*)\b/i.test(reason) && !/\b(?:dispos(?:ed|al)|destroyed)\b/i.test(reason)) {
    return 'NEGATIVE_ADJUSTMENT';
  }
  if (/\b(?:expir\w*)\b/i.test(reason)) return 'EXPIRY';
  if (/\b(?:damag\w*|broken)\b/i.test(reason)) return 'DAMAGE';
  if (/\b(?:write[ -]?off|written off|loss|theft|stolen|missing|disposed|destroyed)\b/i.test(reason)) return 'WRITE_OFF';
  return 'NEGATIVE_ADJUSTMENT';
}

export async function adjustSellableStock(input: {
  tenantId: string; branchId: string; productId: string; batchId: string;
  quantity: number; expectedQuantity: number; reason: string; actorId: string; actorName: string;
}): Promise<boolean> {
  const { tenantId, branchId, productId, batchId, quantity, expectedQuantity, actorId, actorName } = input;
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Enter a valid physical quantity.');
  const reason = input.reason.trim() || 'Manual stock adjustment';
  const batchRefs = await getBranchProductBatchRefs(tenantId, branchId, productId);
  const batchRef = doc(db, 'product_batches', batchId);
  const productRef = doc(db, 'products', productId);
  const movementRef = doc(collection(db, 'inventory_movements'));
  const effectiveAt = new Date();
  const timestamp = effectiveAt.toISOString();
  const reference = `ADJ-${movementRef.id.slice(-8).toUpperCase()}`;

  return runTransaction(db, async transaction => {
    const [batchSnapshot, productSnapshot] = await Promise.all([transaction.get(batchRef), transaction.get(productRef)]);
    const batch = batchSnapshot.data() as ProductBatch | undefined;
    const product = productSnapshot.data();
    if (!batch || batch.tenantId !== tenantId || batch.branchId !== branchId || batch.productId !== productId ||
        !product || product.tenantId !== tenantId) throw new Error('The selected stock no longer belongs to this branch.');
    if (batch.quantity !== expectedQuantity) throw new Error('Stock changed. Refresh the batch before applying the adjustment.');
    const quantityDelta = quantity - batch.quantity;
    if (quantityDelta === 0) return false;

    const eventType = stockAdjustmentEventType(quantityDelta, reason);
    const isLoss = ['EXPIRY', 'DAMAGE', 'WRITE_OFF'].includes(eventType);
    const unitCost = Number.isFinite(batch.purchasePrice) && batch.purchasePrice > 0 ? batch.purchasePrice : undefined;
    await logMovementAndAggregateInTx(transaction, batchRefs, {
      tenantId, branchId, productId, eventType, quantityDeltaBaseUnits: quantityDelta,
      consumptionDeltaBaseUnits: 0, isExceptional: false, exceptionalReason: null,
      sourceCollection: 'product_batches', sourceDocumentId: batchId, sourceLineId: movementRef.id,
      reversalOfEventId: null, createdBy: actorId, effectiveAt,
      ...(isLoss ? { valuationReference: reference, valuationUnitCostUGX: unitCost } : {}),
    });
    const movement: Omit<InventoryMovement, 'id'> = {
      tenantId, branchId, productId, batchId, batchNumber: batch.batchNumber || '', timestamp, reference,
      movementClass: 'adjustment', class: 'adjustment', type: quantityDelta > 0 ? 'in' : 'out',
      initiator: actorName, initiatorId: actorId, receiver: 'System Adjustment', amount: Math.abs(quantityDelta),
      amountAttached: Math.abs(quantityDelta) * (unitCost ?? 0), notes: reason,
    };
    transaction.update(batchRef, { quantity, lastUpdated: timestamp });
    transaction.update(productRef, { stock: Math.max(0, Number(product.stock || 0) + quantityDelta) });
    transaction.set(movementRef, movement);
    return true;
  });
}
