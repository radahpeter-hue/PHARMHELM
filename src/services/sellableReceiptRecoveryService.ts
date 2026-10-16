import { collection, doc, getDocs, query, runTransaction, where, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { getBranchProductBatchRefs, logMovementAndAggregateInTx } from './consumptionService';

/** Durable, idempotent analytics replay for inventory already committed by Stock In. */
export interface SellableReceiptMovementIntent {
  tenantId: string; branchId: string; productId: string;
  transferId: string; lineId: string; quantityBaseUnits: number;
  actorId: string; effectiveAt: string;
  status: 'pending' | 'processed';
}

export const sellableReceiptMovementId = (transferId: string, lineId: string) =>
  `sellable_stockin_${transferId}_${lineId}`;

export async function replaySellableReceiptMovement(
  id: string, tenantId: string, branchId: string
): Promise<'processed' | 'already_processed'> {
  const ref = doc(db, 'sellable_receipt_movement_outbox', id);
  return runTransaction(db, async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists() || snapshot.data().tenantId !== tenantId || snapshot.data().branchId !== branchId) {
      throw new Error('Receipt movement intent does not belong to this branch and tenant.');
    }
    const intent = snapshot.data() as SellableReceiptMovementIntent;
    if (intent.status === 'processed') return 'already_processed';
    if (intent.status !== 'pending' || !Number.isSafeInteger(intent.quantityBaseUnits) || intent.quantityBaseUnits <= 0) {
      throw new Error('Invalid receipt movement intent.');
    }
    // Existing aggregate service uses deterministic event IDs to protect retries.
    // The intent stays pending if this transaction fails or the client closes.
    const batches = await getBranchProductBatchRefs(tenantId, branchId, intent.productId);
    await logMovementAndAggregateInTx(tx, batches, {
      tenantId, branchId, productId: intent.productId, eventType: 'TRANSFER_IN',
      quantityDeltaBaseUnits: intent.quantityBaseUnits, consumptionDeltaBaseUnits: 0,
      stockAlreadyApplied: true, isExceptional: false, exceptionalReason: null,
      sourceCollection: 'transfer_invoices', sourceDocumentId: intent.transferId,
      sourceLineId: intent.lineId, reversalOfEventId: null, createdBy: intent.actorId,
      effectiveAt: new Date(intent.effectiveAt), timezone: 'Africa/Kampala'
    });
    tx.update(ref, { status: 'processed', processedAt: Timestamp.now() });
    return 'processed';
  });
}

/** Safe to invoke when branch Stock In opens, even if the original receiver disappeared. */
export async function reconcilePendingSellableReceipts(tenantId: string, branchId: string): Promise<void> {
  const snapshots = await getDocs(query(
    collection(db, 'sellable_receipt_movement_outbox'),
    where('tenantId', '==', tenantId), where('branchId', '==', branchId)
  ));
  const errors: unknown[] = [];
  for (const intent of snapshots.docs) {
    if (intent.data().branchId !== branchId || intent.data().status !== 'pending') continue;
    try {
      await replaySellableReceiptMovement(intent.id, tenantId, branchId);
    } catch (error) {
      errors.push(error);
      console.error('Sellable Stock In movement reconciliation pending', intent.id, error);
    }
  }
  if (errors.length) throw new Error(`${errors.length} stock movement record(s) still require reconciliation.`);
}
