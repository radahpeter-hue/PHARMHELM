import {
  collection,
  doc,
  increment,
  runTransaction,
  writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';
import { firestoreService } from './firestore';
import { ProductBatch, TransferInvoice, TransferInvoiceLine } from '../types';

export const isHqProcurementDelivery = (transfer: TransferInvoice) =>
  transfer.destination_branch_id === 'HQ' &&
  (transfer.transfer_type === 'procurement_grn' || Boolean((transfer as any).grn_id));

export const isBranchReturnToHq = (transfer: TransferInvoice) =>
  transfer.destination_branch_id === 'HQ' &&
  transfer.source_branch_id !== 'HQ' &&
  !isHqProcurementDelivery(transfer) &&
  ['branch_to_central', 'query_return', 'branch_to_branch'].includes(transfer.transfer_type);

interface ReceiveHqTransferInput {
  tenantId: string;
  transfer: TransferInvoice;
  lines: TransferInvoiceLine[];
  user: { uid: string; name: string };
}

/**
 * Claims and posts one HQ-bound shipment. The claim and deterministic terminal
 * state make browser retries harmless; the inventory writes and receipt status
 * share one batch so stock cannot succeed without the shipment being closed.
 */
export async function receiveHqTransfer(input: ReceiveHqTransferInput): Promise<void> {
  const { tenantId, transfer, lines, user } = input;
  if (!transfer.id || transfer.destination_branch_id !== 'HQ') {
    throw new Error('This shipment is not assigned to the HQ store.');
  }
  if (!lines.length) throw new Error('This shipment has no product lines and cannot be received.');

  const transferRef = doc(db, 'transfer_invoices', transfer.id);
  let claimed = false;
  try {
    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(transferRef);
      if (!snapshot.exists()) throw new Error('The shipment no longer exists.');
      const current = snapshot.data();
      if (current.tenantId !== tenantId) throw new Error('The shipment belongs to another tenant.');
      if (['fully_accepted', 'received', 'queried'].includes(current.status)) {
        throw new Error('This shipment has already been received. No stock was added again.');
      }
      if (current.status === 'receiving') {
        throw new Error('This shipment is already being received by another session.');
      }
      if (current.status !== 'dispatched') throw new Error('Only a dispatched shipment can be received.');
      if (isHqProcurementDelivery({ id: snapshot.id, ...current } as TransferInvoice) && current.order_id) {
        const orderSnapshot = await transaction.get(doc(db, 'stock_orders', current.order_id));
        if (orderSnapshot.exists() && orderSnapshot.data().status === 'fully_received') {
          throw new Error('This older HQ order is already marked received. Stock was not added again; reconcile the legacy dispatch before closing it.');
        }
      }
      transaction.update(transferRef, {
        status: 'receiving',
        reception_claimed_by: user.uid,
        reception_claimed_at: new Date().toISOString()
      });
    });
    claimed = true;

    const existing = await Promise.all(lines.map(line =>
      firestoreService.getDocumentsByQuery<ProductBatch>('product_batches', [
        { field: 'tenantId', operator: '==', value: tenantId },
        { field: 'branchId', operator: '==', value: 'HQ' },
        { field: 'productId', operator: '==', value: line.product_id },
        { field: 'batchNumber', operator: '==', value: line.batch_number || 'UNSPECIFIED' }
      ])
    ));

    const now = new Date().toISOString();
    const batch = writeBatch(db);
    lines.forEach((line, index) => {
      const quantity = Number(line.qty_dispatched || 0);
      if (quantity <= 0) return;
      const existingBatch = existing[index][0];
      if (existingBatch) {
        batch.update(doc(db, 'product_batches', existingBatch.id), {
          quantity: increment(quantity),
          lastUpdated: now
        });
      } else {
        batch.set(doc(collection(db, 'product_batches')), {
          tenantId,
          branchId: 'HQ',
          productId: line.product_id,
          batchNumber: line.batch_number || 'UNSPECIFIED',
          expiryDate: line.expiry_date || '',
          quantity,
          purchasePrice: Number(line.unit_cost_ugx || 0),
          sellingPrice: Number(line.unit_cost_ugx || 0) * 1.3,
          batch_status: 'active',
          sourceType: isHqProcurementDelivery(transfer) ? 'procurement' : 'transfer',
          createdAt: now,
          lastUpdated: now
        });
      }
      batch.update(doc(db, 'transfer_invoice_lines', line.id), {
        qty_received: quantity,
        qty_accepted: quantity,
        line_status: 'received',
        updatedAt: now
      });
    });

    batch.update(transferRef, {
      status: 'fully_accepted',
      accepted_at: now,
      received_at: now,
      received_by: user.uid,
      received_by_name: user.name,
      updatedAt: now
    });
    const orderId = (transfer as any).order_id;
    const grnId = (transfer as any).grn_id;
    if (orderId) {
      batch.update(doc(db, 'stock_orders', orderId), {
        status: 'fully_received',
        received_at: now,
        received_by: user.uid,
        updatedAt: now
      });
    }
    if (grnId) {
      batch.update(doc(db, 'grn_records', grnId), {
        reception_status: 'received',
        receivedAt: now,
        receivedBy: user.uid,
        updatedAt: now
      });
    }
    batch.set(doc(db, 'global_audit_logs', `hq_receipt_${transfer.id}`), {
      tenantId,
      action: 'HQ_STOCK_RECEIPT_CONFIRMED',
      category: 'INVENTORY',
      referenceId: transfer.id,
      grnId: grnId || null,
      orderId: orderId || null,
      actorId: user.uid,
      actor: user.name,
      timestamp: now,
      itemCount: lines.length
    }, { merge: true });
    await batch.commit();
  } catch (error) {
    if (claimed) {
      try {
        await runTransaction(db, async transaction => {
          const snapshot = await transaction.get(transferRef);
          if (snapshot.exists() && snapshot.data().status === 'receiving' && snapshot.data().reception_claimed_by === user.uid) {
            transaction.update(transferRef, {
              status: 'dispatched',
              reception_claimed_by: null,
              reception_claimed_at: null
            });
          }
        });
      } catch (rollbackError) {
        console.error('Failed to release HQ receipt claim', rollbackError);
      }
    }
    throw error;
  }
}
