import { doc, runTransaction, Timestamp, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Explicit Sellable GRN dispatch handoff, idempotent on the canonical transfer.
 * A GRN prepares quantities and their traceable batches; dispatch moves only
 * the transfer status, never credits destination stock.
 * Destination SOH is updated by verified Stock In reception only.
 */
export async function dispatchPreparedSellableGrn(input: {
  tenantId: string;
  grnId: string;
  transferId: string;
  orderId: string;
  actor: { uid: string; name: string };
}, connection: Firestore = db): Promise<{ alreadyDispatched: boolean; transferId: string }> {
  const { tenantId, grnId, transferId, orderId, actor } = input;
  if (![tenantId, grnId, transferId, orderId, actor.uid].every(Boolean)) {
    throw new Error('Tenant, GRN, order, transfer and dispatcher are required.');
  }
  const transferRef = doc(connection, 'transfer_invoices', transferId);
  const grnRef = doc(connection, 'grn_records', grnId);
  const orderRef = doc(connection, 'stock_orders', orderId);
  return runTransaction(connection, async tx => {
    const [transfer, grn, order] = await Promise.all([
      tx.get(transferRef), tx.get(grnRef), tx.get(orderRef)
    ]);
    if (!transfer.exists() || !grn.exists() || !order.exists()) {
      throw new Error('The linked prepared transfer, GRN or order is missing.');
    }
    const t = transfer.data(), g = grn.data(), o = order.data();
    if ([t.tenantId, g.tenantId, o.tenantId].some(id => id !== tenantId) ||
      t.inventoryClass !== 'SELLABLE' || o.inventoryClass === 'OPERATIONAL' ||
      t.order_id !== orderId || t.grn_id !== grnId ||
      g.order_id !== orderId || g.transfer_id !== transferId ||
      t.destination_branch_id !== g.destination_branch_id) {
      throw new Error('Dispatch linkage or tenant boundary does not match the approved GRN.');
    }
    if (t.status === 'dispatched' && g.dispatch_status === 'dispatched' && o.status === 'dispatched') {
      return { alreadyDispatched: true, transferId };
    }
    if (t.status !== 'ready_for_dispatch' || g.dispatch_status !== 'ready_for_dispatch' || o.status !== 'ready_for_dispatch') {
      throw new Error('The GRN is not ready for dispatch; reconcile inconsistent statuses before retry.');
    }
    if (g.grn_status !== 'completed' || !['posted', 'not_applicable'].includes(g.financial_posting_status)) {
      throw new Error('Supplier receipt and Finance handoff must finish before dispatch.');
    }
    const now = Timestamp.now();
    tx.update(transferRef, {
      status: 'dispatched', dispatchedAt: now,
      dispatched_at: now.toDate().toISOString(),
      dispatched_by: actor.uid, dispatched_by_name: actor.name, updatedAt: now
    });
    tx.update(grnRef, { dispatch_status: 'dispatched', reception_status: 'awaiting_receipt', updatedAt: now });
    tx.update(orderRef, { status: 'dispatched', dispatched_at: now.toDate().toISOString(), updatedAt: now });
    return { alreadyDispatched: false, transferId };
  });
}
