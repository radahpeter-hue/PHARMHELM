import type { Firestore } from 'firebase/firestore';
import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import { OperationalInventory, OperationalInventoryMaster } from '../types';
import { buildOperationalHqBufferOrder, operationalHqBufferOrderIds, OperationalHqBufferOrderInput } from './operationalHqBufferOrderPolicy';

/** Creates one validated HQ Operational requisition; requestId is the retry key. */
export async function submitOperationalHqBufferOrder(input: OperationalHqBufferOrderInput, connection: Firestore = db): Promise<{ alreadySubmitted: boolean; orderId: string }> {
  const tenantId = input.tenantId.trim();
  const requestId = input.requestId.trim();
  const quantity = Number(input.quantityPacks);
  if (!tenantId || !input.actor.uid || !requestId || requestId.length > 120 || !Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Tenant, user, request identity and positive pack quantity are required.');
  }
  const ids = operationalHqBufferOrderIds(requestId);
  const orderRef = doc(connection, 'stock_orders', ids.orderId);
  const lineRef = doc(connection, 'stock_order_lines', ids.lineId);
  const itemRef = doc(connection, 'operational_inventory', input.itemId);
  const now = new Date().toISOString();

  const alreadySubmitted = await runTransaction(connection, async transaction => {
    const [settingsSnapshot, itemSnapshot, orderSnapshot, lineSnapshot] = await Promise.all([
      transaction.get(doc(connection, 'system_settings', tenantId)), transaction.get(itemRef),
      transaction.get(orderRef), transaction.get(lineRef)
    ]);
    const settings = settingsSnapshot.data();
    if (!settingsSnapshot.exists() || settings?.tenantId !== tenantId || settings.featureToggles?.enableOperationalInventory !== true) {
      throw new Error('Operational Inventory is disabled in System Settings.');
    }
    if (!itemSnapshot.exists()) throw new Error('The selected HQ Operational item no longer exists.');
    const item = { id: itemSnapshot.id, ...itemSnapshot.data() } as OperationalInventory;
    if (item.tenantId !== tenantId || item.branchId !== 'HQ' || item.inventoryClass !== 'OPERATIONAL' || !item.masterItemId ||
        item.operationalType !== 'CONSUMABLE_OPERATIONAL') {
      throw new Error('Buffer orders require an HQ Operational consumable linked to a tenant Operational master.');
    }
    const masterRef = doc(connection, 'operational_inventory_masters', item.masterItemId);
    const masterSnapshot = await transaction.get(masterRef);
    const master = masterSnapshot.data() as OperationalInventoryMaster | undefined;
    if (!masterSnapshot.exists() || master?.tenantId !== tenantId || master.inventoryClass !== 'OPERATIONAL' ||
        master.operationalType !== item.operationalType || master.hqLocationItemId !== item.id) {
      throw new Error('The selected HQ item is not linked to a valid tenant Operational master.');
    }
    const expected = buildOperationalHqBufferOrder({ ...input, tenantId, requestId, quantityPacks: quantity }, item, now);
    if (orderSnapshot.exists() && lineSnapshot.exists()) {
      const order = orderSnapshot.data();
      const line = lineSnapshot.data();
      const identical = order.tenantId === tenantId && order.inventoryClass === 'OPERATIONAL' && order.category === 'non_sellable' &&
        order.requesting_branch_id === 'HQ' && order.requesting_branch_name === 'HQ Operational Store' &&
        order.order_number === expected.order.order_number && order.generation_method === 'manual' &&
        Number(order.total_order_value_ugx) === expected.order.total_order_value_ugx &&
        line.tenantId === tenantId && line.inventoryClass === 'OPERATIONAL' && line.isOperational === true &&
        line.masterItemId === item.masterItemId && line.order_id === orderRef.id && line.product_id === item.id &&
        line.qty_ordered === quantity && line.unit_cost_ugx === expected.line.unit_cost_ugx && line.line_total_ugx === expected.line.line_total_ugx;
      if (identical) return true;
      throw new Error('This buffer-order request already exists with different contents. Start a new request after checking Procurement.');
    }
    if (orderSnapshot.exists() || lineSnapshot.exists()) throw new Error('The buffer-order request is incomplete. Contact Procurement before retrying.');
    transaction.set(orderRef, expected.order);
    transaction.set(lineRef, expected.line);
    return false;
  });
  return { alreadySubmitted, orderId: orderRef.id };
}
