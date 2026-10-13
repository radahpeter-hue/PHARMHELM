import { collection, doc, getDoc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import type { Firestore, WhereFilterOp } from 'firebase/firestore';
import { db } from '../firebase';
import { firestoreService } from './firestore';
import {
  OperationalInventory,
  OperationalInventoryMaster,
  OperationalTransfer,
  OperationalTransferLine,
  StockOrder,
  StockOrderLine
} from '../types';
import { postOperationalBranchMovement, postOperationalStoreMovement } from './operationalInventoryMovementService';
import { planOperationalOrderFulfillment } from './inventoryClassification';

async function readOperationalDocument<T>(connection: Firestore, name: string, id: string): Promise<T | null> {
  const snapshot = await getDoc(doc(connection, name, id));
  return snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } as T : null;
}
async function readOperationalQuery<T>(connection: Firestore, name: string, filters: { field: string; operator: string; value: any }[]): Promise<T[]> {
  const snapshot = await getDocs(query(collection(connection, name), ...filters.map(filter => where(filter.field, filter.operator as WhereFilterOp, filter.value))));
  return snapshot.docs.map(row => ({ ...row.data(), id: row.id } as T));
}

export interface OperationalTransferActor { uid: string; name: string; }

export interface DispatchOperationalOrderInput {
  tenantId: string;
  order: StockOrder;
  destinationBranchName: string;
  actor: OperationalTransferActor;
}

export interface DispatchOperationalOrderResult {
  transferId: string;
  transferNumber: string;
  alreadyDispatched: boolean;
  lineCount: number;
}

export interface ReceiveOperationalTransferLineInput {
  tenantId: string;
  transferId: string;
  line: OperationalTransferLine;
  accepted: number;
  queried: number;
  queryReason?: string;
  actor: OperationalTransferActor;
  activeBranchId: string;
}

export async function createOperationalBranchReturn(input: {
  tenantId: string; branchId: string; itemId: string; quantity: number; reason: string; requestId: string; actor: OperationalTransferActor;
}, connection: Firestore = db): Promise<{ transferId: string; transferNumber: string }> {
  const { tenantId, branchId, itemId, actor } = input;
  const quantity = Number(input.quantity);
  if (!tenantId || !branchId || branchId === 'HQ' || !actor.uid || !input.reason.trim() || !Number.isFinite(quantity) || quantity <= 0) throw new Error('Branch, item, positive quantity, return reason and user are required.');
  const source = await readOperationalDocument<OperationalInventory>(connection, 'operational_inventory', itemId);
  if (!source || source.tenantId !== tenantId || source.branchId !== branchId || source.inventoryClass !== 'OPERATIONAL' || !source.masterItemId) throw new Error('Select an Operational item from the active branch.');
  const master = await readOperationalDocument<OperationalInventoryMaster>(connection, 'operational_inventory_masters', source.masterItemId);
  if (!master || master.tenantId !== tenantId || master.inventoryClass !== 'OPERATIONAL' || !master.hqLocationItemId || master.unitPerPack !== source.unitPerPack) throw new Error('The matching HQ Operational Store item is not configured.');
  const hqItem = { id: master.hqLocationItemId };
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.requestId)) throw new Error('A valid return request reference is required.');
  const transferId = `optr_return_${safeId(input.requestId)}`;
  const lineId = `optrl_${hash(`${transferId}|${master.id}`)}`;
  const transferNumber = `OR-${new Date().getFullYear()}-${hash(`${tenantId}|${transferId}`)}`;
  const movementKey = `return_out_${hash(lineId)}`;
  const now = new Date().toISOString();
  await runTransaction(connection, async transaction => {
    const settingsRef = doc(connection, 'system_settings', tenantId);
    const sourceRef = doc(connection, 'operational_inventory', source.id);
    const masterRef = doc(connection, 'operational_inventory_masters', master.id);
    const headerRef = doc(connection, 'operational_transfers', transferId);
    const lineRef = doc(connection, 'operational_transfer_lines', lineId);
    const movementRef = doc(connection, 'operational_inventory_movements', `opm_${movementKey}`);
    const [settings, sourceSnapshot, masterSnapshot, existing] = await Promise.all([transaction.get(settingsRef), transaction.get(sourceRef), transaction.get(masterRef), transaction.get(headerRef)]);
    assertOperationalEnabled(settings.data(), tenantId);
    if (existing.exists()) {
      if (existing.data().tenantId !== tenantId || existing.data().sourceBranchId !== branchId || existing.data().requestPayloadKey !== `${itemId}_${quantity}_${input.reason.trim()}`) throw new Error('This return reference is already used by another transaction.');
      return;
    }
    if (!sourceSnapshot.exists() || !masterSnapshot.exists() || sourceSnapshot.data().tenantId !== tenantId || sourceSnapshot.data().branchId !== branchId || sourceSnapshot.data().inventoryClass !== 'OPERATIONAL' || masterSnapshot.data().tenantId !== tenantId || masterSnapshot.data().inventoryClass !== 'OPERATIONAL' || sourceSnapshot.data().masterItemId !== masterSnapshot.id || masterSnapshot.data().hqLocationItemId !== hqItem.id) throw new Error('Operational return locations changed; refresh and retry.');
    const before = Number(sourceSnapshot.data().quantityInStock || 0);
    if (before < quantity) throw new Error('The return quantity exceeds branch Operational stock.');
    const unitCostUGX = Number(sourceSnapshot.data().costPerPack || 0) / Math.max(1, Number(sourceSnapshot.data().unitPerPack || 1));
    transaction.set(headerRef, { id: transferId, tenantId, inventoryClass: 'OPERATIONAL', transferType: 'BRANCH_RETURN', fulfillmentSource: 'BRANCH_RETURN', transferNumber, sourceLocationId: `BRANCH_${branchId}`, sourceBranchId: branchId, destinationBranchId: 'HQ', destinationBranchName: 'HQ Operational Store', expectedLineCount: 1, remainingExternalPacks: 0, totalValueUGX: quantity * unitCostUGX, receiptMovementId: `opm_return_in_${hash(lineId)}`, requestPayloadKey: `${itemId}_${quantity}_${input.reason.trim()}`, status: 'dispatched', dispatchedBy: actor.uid, dispatchedByName: actor.name, dispatchedAt: now, returnReason: input.reason.trim(), createdAt: now, updatedAt: now });
    transaction.set(lineRef, { id: lineId, tenantId, inventoryClass: 'OPERATIONAL', transferId, destinationBranchId: 'HQ', masterItemId: master.id, sourceItemId: source.id, destinationItemId: hqItem.id, itemName: master.name, quantityDispatched: quantity, unitOfIssue: master.unitOfIssue, unitCostUGX, totalValueUGX: quantity * unitCostUGX, dispatchMovementId: `opm_${movementKey}`, receiptMovementId: `opm_return_in_${hash(lineId)}`, status: 'dispatched', dispatchedBy: actor.uid, dispatchedAt: now, createdAt: now, updatedAt: now });
    transaction.update(sourceRef, { quantityInStock: before - quantity, lastMovementId: `opm_${movementKey}`, updatedAt: now });
    transaction.set(movementRef, { tenantId, inventoryClass: 'OPERATIONAL', itemId: source.id, masterItemId: master.id, itemName: master.name, locationId: `BRANCH_${branchId}`, branchId, movementType: 'TRANSFER_OUT', quantityDelta: -quantity, balanceBefore: before, balanceAfter: before - quantity, unitCostUGX, totalValueUGX: quantity * unitCostUGX, reference: transferNumber, reason: input.reason.trim(), idempotencyKey: movementKey, actorId: actor.uid, actorName: actor.name, sourceTransactionId: transferId, sourceLineId: lineId, createdAt: now });
  });
  return { transferId, transferNumber };
}

export async function receiveOperationalBranchReturn(input: { tenantId: string; transferId: string; line: OperationalTransferLine; actor: OperationalTransferActor }, connection: Firestore = db): Promise<{ alreadyReceived: boolean }> {
  const { tenantId, transferId, line, actor } = input;
  if (!tenantId || !actor.uid || line.inventoryClass !== 'OPERATIONAL') throw new Error('Operational return, tenant and receiving user are required.');
  const headerRef = doc(connection, 'operational_transfers', transferId);
  const lineRef = doc(connection, 'operational_transfer_lines', line.id);
  const hqItemRef = doc(connection, 'operational_inventory', line.destinationItemId);
  const movementKey = `return_in_${hash(line.id)}`;
  const movementRef = doc(connection, 'operational_inventory_movements', `opm_${movementKey}`);
  const settingsRef = doc(connection, 'system_settings', tenantId);
  return runTransaction(connection, async transaction => {
    const [settings, header, lineSnapshot, hqItem, movement] = await Promise.all([transaction.get(settingsRef), transaction.get(headerRef), transaction.get(lineRef), transaction.get(hqItemRef), transaction.get(movementRef)]);
    assertOperationalEnabled(settings.data(), tenantId);
    if (!header.exists() || header.data().tenantId !== tenantId || header.data().inventoryClass !== 'OPERATIONAL' || header.data().transferType !== 'BRANCH_RETURN' || header.data().destinationBranchId !== 'HQ') throw new Error('This is not a pending Operational branch return.');
    if (!lineSnapshot.exists() || lineSnapshot.data().tenantId !== tenantId || lineSnapshot.data().transferId !== transferId || lineSnapshot.data().destinationItemId !== hqItemRef.id) throw new Error('The Operational return line is invalid.');
    if (lineSnapshot.data().status === 'received') return { alreadyReceived: true };
    if (lineSnapshot.data().status !== 'dispatched' || !hqItem.exists() || hqItem.data().tenantId !== tenantId || hqItem.data().branchId !== 'HQ' || hqItem.data().inventoryClass !== 'OPERATIONAL' || hqItem.data().masterItemId !== line.masterItemId) throw new Error('HQ Operational Store item does not match this return.');
    if (movement.exists()) throw new Error('A return receipt movement already exists; reconcile before retrying.');
    const before = Number(hqItem.data().quantityInStock || 0);
    const after = before + line.quantityDispatched;
    const now = new Date().toISOString();
    transaction.update(hqItemRef, { quantityInStock: after, lastMovementId: `opm_${movementKey}`, updatedAt: now });
    transaction.set(movementRef, { tenantId, inventoryClass: 'OPERATIONAL', itemId: hqItemRef.id, masterItemId: line.masterItemId, itemName: line.itemName, locationId: 'HQ_OPERATIONAL', branchId: 'HQ', movementType: 'TRANSFER_IN', quantityDelta: line.quantityDispatched, balanceBefore: before, balanceAfter: after, unitCostUGX: line.unitCostUGX, totalValueUGX: line.totalValueUGX, reference: header.data().transferNumber, idempotencyKey: movementKey, actorId: actor.uid, actorName: actor.name, sourceTransactionId: transferId, sourceLineId: line.id, createdAt: now });
    transaction.update(lineRef, { status: 'received', quantityAccepted: line.quantityDispatched, quantityQueried: 0, receivedBy: actor.uid, receivedAt: now, receiptMovementId: `opm_${movementKey}`, updatedAt: now });
    transaction.update(headerRef, { status: 'received', receivedBy: actor.uid, receivedByName: actor.name, receivedAt: now, updatedAt: now });
    return { alreadyReceived: false };
  });
}

/** Creates a traceable HQ-initiated Operational distribution without a branch order. */
export async function createHqOperationalDistribution(input: {
  tenantId: string; destinationBranchId: string; destinationBranchName: string;
  itemId: string; quantity: number; requestId: string; actor: OperationalTransferActor;
}, connection: Firestore = db): Promise<{ transferId: string; transferNumber: string }> {
  const tenantId = input.tenantId.trim();
  const quantity = Number(input.quantity);
  if (!tenantId || !input.actor.uid || !input.destinationBranchId || input.destinationBranchId === 'HQ' || !Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('A destination branch, positive quantity and authorized user are required.');
  }
  const hqItem = await readOperationalDocument<OperationalInventory>(connection, 'operational_inventory', input.itemId);
  if (!hqItem || hqItem.tenantId !== tenantId || hqItem.branchId !== 'HQ' || hqItem.inventoryClass !== 'OPERATIONAL' || !hqItem.masterItemId) {
    throw new Error('Select an Operational item from the HQ Operational Store.');
  }
  const master = await readOperationalDocument<OperationalInventoryMaster>(connection, 'operational_inventory_masters', hqItem.masterItemId);
  const copies = await readOperationalQuery<OperationalInventory>(connection, 'operational_inventory', [
    { field: 'tenantId', operator: '==', value: tenantId }, { field: 'masterItemId', operator: '==', value: hqItem.masterItemId }
  ]);
  const destination = copies.find(item => item.branchId === input.destinationBranchId);
  if (!master || master.tenantId !== tenantId || master.inventoryClass !== 'OPERATIONAL' || !destination || destination.inventoryClass !== 'OPERATIONAL' || destination.unitPerPack !== hqItem.unitPerPack) {
    throw new Error('Register this Operational item at the destination branch with matching units before distribution.');
  }
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.requestId)) throw new Error('A valid distribution request reference is required.');
  const transferId = `optr_direct_${safeId(input.requestId)}`;
  const requestPayloadKey = `${input.itemId}_${quantity}`;
  const lineId = `optrl_${hash(`${transferId}|${hqItem.masterItemId}`)}`;
  const transferNumber = `OTD-${new Date().getFullYear()}-${hash(`${tenantId}|${transferId}`)}`;
  const units = quantity;
  const unitCostUGX = Number(hqItem.costPerPack || 0) / Math.max(1, Number(hqItem.unitPerPack || 1));
  const now = new Date().toISOString();
  const transferRef = doc(connection, 'operational_transfers', transferId);
  const lineRef = doc(connection, 'operational_transfer_lines', lineId);
  const settingsRef = doc(connection, 'system_settings', tenantId);
  await runTransaction(connection, async transaction => {
    const [settings, source, target, existing] = await Promise.all([
      transaction.get(settingsRef), transaction.get(doc(connection, 'operational_inventory', hqItem.id)),
      transaction.get(doc(connection, 'operational_inventory', destination.id)), transaction.get(transferRef)
    ]);
    assertOperationalEnabled(settings.data(), tenantId);
    if (existing.exists()) {
      if (existing.data().tenantId !== tenantId || existing.data().destinationBranchId !== input.destinationBranchId || existing.data().inventoryClass !== 'OPERATIONAL' || existing.data().requestPayloadKey !== requestPayloadKey) throw new Error('This distribution reference is already used by another transaction.');
      return;
    }
    if (!source.exists() || !target.exists() || source.data().tenantId !== tenantId || source.data().branchId !== 'HQ' || source.data().inventoryClass !== 'OPERATIONAL' || target.data().tenantId !== tenantId || target.data().branchId !== input.destinationBranchId || target.data().inventoryClass !== 'OPERATIONAL' || source.data().masterItemId !== target.data().masterItemId) throw new Error('Operational source or destination changed; refresh and retry.');
    if (Number(source.data().quantityInStock || 0) < units) throw new Error('HQ Operational stock is insufficient for this distribution.');
    transaction.set(transferRef, {
      id: transferId, tenantId, inventoryClass: 'OPERATIONAL', fulfillmentSource: 'HQ_DIRECT', transferNumber,
      sourceLocationId: 'HQ_OPERATIONAL', sourceBranchId: 'HQ', destinationBranchId: input.destinationBranchId,
      destinationBranchName: input.destinationBranchName, expectedLineCount: 1, remainingExternalPacks: 0,
      totalValueUGX: units * unitCostUGX, status: 'draft', dispatchedBy: input.actor.uid, dispatchedByName: input.actor.name,
      requestPayloadKey, createdAt: now, updatedAt: now
    });
    transaction.set(lineRef, {
      id: lineId, tenantId, inventoryClass: 'OPERATIONAL', transferId, destinationBranchId: input.destinationBranchId,
      masterItemId: master.id, sourceItemId: hqItem.id, destinationItemId: destination.id, itemName: master.name,
      quantityDispatched: units, unitOfIssue: master.unitOfIssue, unitCostUGX, totalValueUGX: units * unitCostUGX,
      dispatchMovementId: `opm_${movementKeyForTransferLine(lineId, 'out')}`,
      receiptMovementId: `opm_${movementKeyForTransferLine(lineId, 'in')}`, status: 'prepared', createdAt: now, updatedAt: now
    });
  });
  await dispatchPreparedOperationalHqTransfer({ tenantId, transferId, actor: input.actor }, connection);
  return { transferId, transferNumber };
}

const hash = (value: string) => {
  let code = 2166136261;
  for (let index = 0; index < value.length; index++) {
    code ^= value.charCodeAt(index);
    code = Math.imul(code, 16777619);
  }
  return (code >>> 0).toString(36).toUpperCase();
};

const safeId = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
const transferIdForOrder = (orderId: string) => `optr_${safeId(orderId)}_${hash(orderId)}`;
const transferLineIdForOrderLine = (transferId: string, orderLineId: string) => `optrl_${hash(`${transferId}|${orderLineId}`)}`;
const movementKeyForTransferLine = (transferLineId: string, direction: 'out' | 'in') => `transfer_${direction}_${hash(transferLineId)}`;
const internalTransferIdForLine = (orderId: string, lineId: string) => `optr_${safeId(orderId)}_hq_${hash(`${orderId}|${lineId}|hq`)}`;
const internalTransferLineIdForLine = (transferId: string, lineId: string) => `optrl_${hash(`${transferId}|${lineId}`)}`;

function assertOperationalEnabled(settings: any, tenantId: string) {
  if (settings?.tenantId !== tenantId || settings?.featureToggles?.enableOperationalInventory !== true) {
    throw new Error('Operational Inventory is disabled in System Settings.');
  }
}

/** Dispatches only stock actually received against an Operational external-sourcing order. */
export async function dispatchOperationalOrderToBranch(
  input: DispatchOperationalOrderInput
): Promise<DispatchOperationalOrderResult> {
  const tenantId = input.tenantId.trim();
  const { order, actor } = input;
  if (!tenantId || !actor.uid || order.tenantId !== tenantId || order.id === '') throw new Error('Tenant, order and dispatching user are required.');
  if (order.inventoryClass !== 'OPERATIONAL' && order.category !== 'non_sellable') throw new Error('Only Operational Inventory orders can use this dispatch flow.');
  if (!order.requesting_branch_id || order.requesting_branch_id === 'HQ') throw new Error('The Operational order must target a branch.');

  const transferId = transferIdForOrder(order.id);
  const transferRef = doc(db, 'operational_transfers', transferId);
  const orderRef = doc(db, 'stock_orders', order.id);
  const settingsRef = doc(db, 'system_settings', tenantId);
  const now = new Date().toISOString();
  const sourceLines = await firestoreService.getDocumentsByQuery<StockOrderLine>('stock_order_lines', [
    { field: 'tenantId', operator: '==', value: tenantId },
    { field: 'order_id', operator: '==', value: order.id }
  ]);
  const receivedLines = sourceLines.filter(line =>
    line.inventoryClass === 'OPERATIONAL' && line.supplier_type === 'external' &&
    line.line_status === 'received' && Number(line.qty_received || 0) > 0 && Boolean(line.masterItemId)
  );
  if (!receivedLines.length) throw new Error('No fully received, identity-linked Operational supplier lines are ready to dispatch.');
  if (receivedLines.length > 12) throw new Error('Dispatch this order in groups of 12 Operational lines or fewer.');
  if (new Set(receivedLines.map(line => line.masterItemId)).size !== receivedLines.length) {
    throw new Error('An Operational item appears on more than one received order line. Resolve duplicate lines before dispatch.');
  }

  const linesToDispatch = receivedLines.map(line => {
    const qtyPacks = Number(line.qty_received || 0);
    const costPerPack = Number(line.unit_cost_ugx || 0);
    if (!Number.isFinite(qtyPacks) || qtyPacks <= 0 || !Number.isFinite(costPerPack) || costPerPack < 0) {
      throw new Error(`Received quantity or cost is invalid for ${line.product_name || line.id}.`);
    }
    return { line, qtyPacks, costPerPack };
  });
  const totalValueUGX = linesToDispatch.reduce((sum, row) => sum + row.qtyPacks * row.costPerPack, 0);
  const transferNumber = `OT-${new Date().getFullYear()}-${hash(`${tenantId}|${transferId}`)}`;

  await runTransaction(db, async transaction => {
    const [settingsSnapshot, orderSnapshot, transferSnapshot] = await Promise.all([
      transaction.get(settingsRef), transaction.get(orderRef), transaction.get(transferRef)
    ]);
    assertOperationalEnabled(settingsSnapshot.data(), tenantId);
    const liveOrder = orderSnapshot.data();
    if (!orderSnapshot.exists() || liveOrder?.tenantId !== tenantId ||
        !(liveOrder.inventoryClass === 'OPERATIONAL' || liveOrder.category === 'non_sellable')) {
      throw new Error('The source order is missing, belongs to another tenant, or is not Operational.');
    }
    if (transferSnapshot.exists()) {
      const existing = transferSnapshot.data();
      if (existing.tenantId !== tenantId || existing.sourceOrderId !== order.id || existing.destinationBranchId !== order.requesting_branch_id) {
        throw new Error('An Operational transfer already exists with conflicting source or destination details.');
      }
      if (existing.status === 'dispatched' || ['received', 'queried'].includes(existing.status)) return;
      if (!['draft', 'dispatching'].includes(existing.status)) throw new Error('This Operational transfer cannot be resumed from its current status.');
      transaction.update(transferRef, { status: 'dispatching', updatedAt: now });
      return;
    }
    if (liveOrder.status !== 'fully_received') throw new Error('The Operational order must be fully received before branch dispatch.');
    transaction.set(transferRef, {
      id: transferId, tenantId, inventoryClass: 'OPERATIONAL', fulfillmentSource: 'EXTERNAL_SUPPLIER', transferNumber,
      sourceLocationId: 'HQ_OPERATIONAL', sourceBranchId: 'HQ',
      destinationBranchId: order.requesting_branch_id,
      destinationBranchName: input.destinationBranchName,
      sourceOrderId: order.id, sourceOrderNumber: order.order_number,
      status: 'draft', expectedLineCount: linesToDispatch.length, remainingExternalPacks: 0,
      totalValueUGX, dispatchedBy: actor.uid, dispatchedByName: actor.name,
      createdAt: now, updatedAt: now
    });
  });

  const transferSnapshot = await firestoreService.getDocument<OperationalTransfer>('operational_transfers', transferId);
  if (!transferSnapshot || transferSnapshot.tenantId !== tenantId) throw new Error('The Operational transfer could not be loaded after creation.');
  if (['dispatched', 'received', 'queried'].includes(transferSnapshot.status)) {
    return { transferId, transferNumber: transferSnapshot.transferNumber, alreadyDispatched: true, lineCount: linesToDispatch.length };
  }

  for (const row of linesToDispatch) {
    const masterId = row.line.masterItemId!;
    const master = await firestoreService.getDocument<OperationalInventoryMaster>('operational_inventory_masters', masterId);
    if (!master || master.tenantId !== tenantId || master.inventoryClass !== 'OPERATIONAL' || !master.hqLocationItemId) {
      throw new Error(`Operational identity ${masterId} has no verified HQ location item.`);
    }
    const sourceItem = await firestoreService.getDocument<OperationalInventory>('operational_inventory', master.hqLocationItemId);
    if (!sourceItem || sourceItem.tenantId !== tenantId || sourceItem.branchId !== 'HQ' ||
        sourceItem.inventoryClass !== 'OPERATIONAL' || sourceItem.masterItemId !== masterId) {
      throw new Error(`The HQ Operational stock record for ${master.name} is missing or mismatched.`);
    }
    const destinationCopies = await firestoreService.getDocumentsByQuery<OperationalInventory>('operational_inventory', [
      { field: 'tenantId', operator: '==', value: tenantId },
      { field: 'masterItemId', operator: '==', value: masterId }
    ]);
    const destinationItem = destinationCopies.find(item => item.branchId === order.requesting_branch_id);
    if (!destinationItem || destinationItem.inventoryClass !== 'OPERATIONAL') {
      throw new Error(`Register ${master.name} at ${order.requesting_branch_name || order.requesting_branch_id} before dispatch.`);
    }
    if (destinationItem.unitPerPack !== sourceItem.unitPerPack) throw new Error(`Issue units do not match for ${master.name} at the destination branch.`);
    const quantityDispatched = row.qtyPacks * Math.max(1, Number(master.unitPerPack || sourceItem.unitPerPack || 1));
    const unitCostUGX = row.costPerPack / Math.max(1, Number(master.unitPerPack || 1));
    const lineId = transferLineIdForOrderLine(transferId, row.line.id);
    const transferLineRef = doc(db, 'operational_transfer_lines', lineId);
    const orderLineRef = doc(db, 'stock_order_lines', row.line.id);
    const masterRef = doc(db, 'operational_inventory_masters', masterId);
    const sourceItemRef = doc(db, 'operational_inventory', sourceItem.id);
    const destinationItemRef = doc(db, 'operational_inventory', destinationItem.id);

    await runTransaction(db, async transaction => {
      const [headerSnapshot, sourceLineSnapshot, currentMaster, currentHq, currentDestination, lineSnapshot] = await Promise.all([
        transaction.get(transferRef), transaction.get(orderLineRef), transaction.get(masterRef),
        transaction.get(sourceItemRef), transaction.get(destinationItemRef), transaction.get(transferLineRef)
      ]);
      if (!headerSnapshot.exists() || headerSnapshot.data().tenantId !== tenantId || headerSnapshot.data().inventoryClass !== 'OPERATIONAL') throw new Error('Operational transfer header is invalid.');
      if (!sourceLineSnapshot.exists() || sourceLineSnapshot.data().order_id !== order.id || sourceLineSnapshot.data().masterItemId !== masterId || sourceLineSnapshot.data().qty_received !== row.qtyPacks) throw new Error('The received order line changed during dispatch preparation.');
      if (!currentMaster.exists() || currentMaster.data().tenantId !== tenantId || currentMaster.data().inventoryClass !== 'OPERATIONAL') throw new Error('The Operational master changed during dispatch preparation.');
      if (!currentHq.exists() || currentHq.data().tenantId !== tenantId || currentHq.data().branchId !== 'HQ' || currentHq.data().masterItemId !== masterId) throw new Error('The HQ Operational item changed during dispatch preparation.');
      if (!currentDestination.exists() || currentDestination.data().tenantId !== tenantId || currentDestination.data().branchId !== order.requesting_branch_id || currentDestination.data().masterItemId !== masterId) throw new Error('The destination Operational item changed during dispatch preparation.');
      if (lineSnapshot.exists()) {
        const existing = lineSnapshot.data();
        if (existing.tenantId !== tenantId || existing.sourceItemId !== sourceItem.id || existing.destinationItemId !== destinationItem.id || existing.quantityDispatched !== quantityDispatched) throw new Error('An existing Operational transfer line conflicts with current order data.');
        return;
      }
      transaction.set(transferLineRef, {
        id: lineId, tenantId, inventoryClass: 'OPERATIONAL', transferId,
        destinationBranchId: order.requesting_branch_id,
        masterItemId: masterId, sourceItemId: sourceItem.id, destinationItemId: destinationItem.id,
        itemName: master.name, sourceOrderLineId: row.line.id,
        quantityDispatched, unitOfIssue: master.unitOfIssue,
        unitCostUGX, totalValueUGX: quantityDispatched * unitCostUGX,
        dispatchMovementId: `opm_${movementKeyForTransferLine(lineId, 'out')}`,
        receiptMovementId: `opm_${movementKeyForTransferLine(lineId, 'in')}`,
        status: 'prepared', createdAt: now, updatedAt: now
      });
    });
  }

  const transferLines = await firestoreService.getDocumentsByQuery<OperationalTransferLine>('operational_transfer_lines', [
    { field: 'tenantId', operator: '==', value: tenantId },
    { field: 'transferId', operator: '==', value: transferId }
  ]);
  if (transferLines.length !== linesToDispatch.length) throw new Error('The Operational transfer is incomplete. Reopen and retry dispatch.');

  for (const line of transferLines) {
    if (line.status === 'dispatched' || ['received', 'queried'].includes(line.status)) continue;
    await postOperationalStoreMovement({
      tenantId, itemId: line.sourceItemId, quantityDelta: -line.quantityDispatched,
      movementType: 'TRANSFER_OUT', reference: transferNumber,
      idempotencyKey: movementKeyForTransferLine(line.id, 'out'), actorId: actor.uid,
      actorName: actor.name, sourceTransactionId: transferId, sourceLineId: line.id
    });
    const lineRef = doc(db, 'operational_transfer_lines', line.id);
    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(lineRef);
      if (!snapshot.exists() || snapshot.data().tenantId !== tenantId || snapshot.data().transferId !== transferId) throw new Error('The Operational transfer line cannot be completed.');
      if (snapshot.data().status === 'dispatched') return;
      if (snapshot.data().status !== 'prepared') throw new Error('The Operational transfer line is no longer awaiting dispatch.');
      transaction.update(lineRef, { status: 'dispatched', dispatchedBy: actor.uid, dispatchedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });
  }

  const completedAt = new Date().toISOString();
  await runTransaction(db, async transaction => {
    const sourceLineRefs = linesToDispatch.map(row => doc(db, 'stock_order_lines', row.line.id));
    const [headerSnapshot, orderSnapshot, sourceLineSnapshots] = await Promise.all([
      transaction.get(transferRef), transaction.get(orderRef),
      Promise.all(sourceLineRefs.map(ref => transaction.get(ref)))
    ]);
    if (!headerSnapshot.exists() || !orderSnapshot.exists() || headerSnapshot.data().tenantId !== tenantId || orderSnapshot.data().tenantId !== tenantId) throw new Error('The Operational transfer or its order disappeared during dispatch.');
    if (sourceLineSnapshots.some(snapshot => !snapshot.exists() || snapshot.data().tenantId !== tenantId || snapshot.data().order_id !== order.id || snapshot.data().inventoryClass !== 'OPERATIONAL' || snapshot.data().supplier_type !== 'external' || snapshot.data().line_status !== 'received')) {
      throw new Error('An externally received Operational line changed before branch dispatch finalization.');
    }
    transaction.update(transferRef, { status: 'dispatched', dispatchedAt: completedAt, dispatchedBy: actor.uid, dispatchedByName: actor.name, updatedAt: completedAt });
    transaction.update(orderRef, { status: 'dispatched', operational_external_transfer_id: transferId, dispatched_at: completedAt, updatedAt: completedAt });
    sourceLineRefs.forEach(lineRef => transaction.update(lineRef, { operational_external_transfer_id: transferId, updatedAt: completedAt }));
  });

  return { transferId, transferNumber: transferSnapshot.transferNumber, alreadyDispatched: false, lineCount: transferLines.length };
}

export interface FulfillOperationalOrderFromStoreInput {
  tenantId: string;
  order: StockOrder;
  line: StockOrderLine;
  quantityPacks: number;
  actor: OperationalTransferActor;
}

/**
 * Reserves and dispatches an Operational order line from the HQ Operational
 * Store. If HQ cannot cover the whole line, it splits the unfulfilled balance
 * into a linked Operational sourcing line under the same order.
 */
export async function fulfillOperationalOrderFromHqStore(input: FulfillOperationalOrderFromStoreInput): Promise<{
  transferId: string;
  transferNumber: string;
  quantityPacks: number;
  remainingExternalPacks: number;
  alreadyDispatched: boolean;
}> {
  const tenantId = input.tenantId.trim();
  const { order, line, actor } = input;
  const quantityPacks = Number(input.quantityPacks);
  if (!tenantId || !actor.uid || order.tenantId !== tenantId || line.tenantId !== tenantId || line.order_id !== order.id) {
    throw new Error('Tenant, Operational order, order line and dispatching user must match.');
  }
  if (!(order.inventoryClass === 'OPERATIONAL' || order.category === 'non_sellable') || line.inventoryClass !== 'OPERATIONAL' || !line.masterItemId) {
    throw new Error('Only identity-linked Operational order lines can be fulfilled from the Operational Store.');
  }
  if (!Number.isFinite(quantityPacks) || quantityPacks <= 0 || quantityPacks > Number(line.qty_ordered || 0)) {
    throw new Error('Enter a valid pack quantity within the outstanding Operational order quantity.');
  }
  if (!order.requesting_branch_id || order.requesting_branch_id === 'HQ') throw new Error('Operational store fulfilment must target a branch.');

  const transferId = internalTransferIdForLine(order.id, line.id);
  const transferLineId = internalTransferLineIdForLine(transferId, line.id);
  const transferRef = doc(db, 'operational_transfers', transferId);
  const transferLineRef = doc(db, 'operational_transfer_lines', transferLineId);
  const orderRef = doc(db, 'stock_orders', order.id);
  const orderLineRef = doc(db, 'stock_order_lines', line.id);
  const externalLineId = `${safeId(line.id).slice(0, 80)}_ext_${hash(transferId)}`;
  const externalLineRef = doc(db, 'stock_order_lines', externalLineId);
  const settingsRef = doc(db, 'system_settings', tenantId);
  const masterRef = doc(db, 'operational_inventory_masters', line.masterItemId);
  const master = await firestoreService.getDocument<OperationalInventoryMaster>('operational_inventory_masters', line.masterItemId);
  if (!master || master.tenantId !== tenantId || master.inventoryClass !== 'OPERATIONAL' || !master.hqLocationItemId) {
    throw new Error('The Operational master item has no verified HQ Operational location.');
  }
  const hqItem = await firestoreService.getDocument<OperationalInventory>('operational_inventory', master.hqLocationItemId);
  if (!hqItem || hqItem.tenantId !== tenantId || hqItem.branchId !== 'HQ' || hqItem.inventoryClass !== 'OPERATIONAL' || hqItem.masterItemId !== master.id) {
    throw new Error('The HQ Operational stock record is missing or mismatched.');
  }
  const branchCopies = await firestoreService.getDocumentsByQuery<OperationalInventory>('operational_inventory', [
    { field: 'tenantId', operator: '==', value: tenantId },
    { field: 'masterItemId', operator: '==', value: master.id }
  ]);
  const destinationItem = branchCopies.find(item => item.branchId === order.requesting_branch_id);
  if (!destinationItem || destinationItem.inventoryClass !== 'OPERATIONAL' || destinationItem.unitPerPack !== hqItem.unitPerPack) {
    throw new Error('Register this Operational item at the destination branch with matching issue units before fulfilment.');
  }
  const unitsPerPack = Math.max(1, Number(master.unitPerPack || hqItem.unitPerPack || 1));
  const quantityUnits = quantityPacks * unitsPerPack;
  const unitCostUGX = Number(hqItem.costPerPack || 0) / unitsPerPack;
  let remainingExternalPacks = Number(line.qty_ordered || 0) - quantityPacks;
  const transferNumber = `OT-${new Date().getFullYear()}-${hash(`${tenantId}|${transferId}`)}`;
  const now = new Date().toISOString();

  await runTransaction(db, async transaction => {
    const [settingsSnapshot, orderSnapshot, orderLineSnapshot, masterSnapshot, hqSnapshot, destinationSnapshot, transferSnapshot, transferLineSnapshot, externalSnapshot] = await Promise.all([
      transaction.get(settingsRef), transaction.get(orderRef), transaction.get(orderLineRef), transaction.get(masterRef),
      transaction.get(doc(db, 'operational_inventory', hqItem.id)), transaction.get(doc(db, 'operational_inventory', destinationItem.id)),
      transaction.get(transferRef), transaction.get(transferLineRef), transaction.get(externalLineRef)
    ]);
    assertOperationalEnabled(settingsSnapshot.data(), tenantId);
    if (!orderSnapshot.exists() || orderSnapshot.data().tenantId !== tenantId || !(orderSnapshot.data().inventoryClass === 'OPERATIONAL' || orderSnapshot.data().category === 'non_sellable') || orderSnapshot.data().requesting_branch_id !== destinationItem.branchId) {
      throw new Error('The source order is missing or no longer matches the Operational destination.');
    }
    if (!orderLineSnapshot.exists() || orderLineSnapshot.data().tenantId !== tenantId || orderLineSnapshot.data().order_id !== order.id || orderLineSnapshot.data().inventoryClass !== 'OPERATIONAL' || orderLineSnapshot.data().masterItemId !== master.id) {
      throw new Error('The Operational order line changed or is not linked to the requested item.');
    }
    if (!masterSnapshot.exists() || masterSnapshot.data().tenantId !== tenantId || masterSnapshot.data().inventoryClass !== 'OPERATIONAL') throw new Error('Operational master identity changed.');
    if (!hqSnapshot.exists() || !destinationSnapshot.exists() || hqSnapshot.data().tenantId !== tenantId || hqSnapshot.data().branchId !== 'HQ' || hqSnapshot.data().inventoryClass !== 'OPERATIONAL' || hqSnapshot.data().masterItemId !== master.id || destinationSnapshot.data().tenantId !== tenantId || destinationSnapshot.data().branchId !== order.requesting_branch_id || destinationSnapshot.data().inventoryClass !== 'OPERATIONAL' || destinationSnapshot.data().masterItemId !== master.id) {
      throw new Error('HQ or destination Operational inventory identity changed.');
    }
    if (Number(hqSnapshot.data().unitPerPack || 1) !== unitsPerPack || Number(destinationSnapshot.data().unitPerPack || 1) !== unitsPerPack) {
      throw new Error('The HQ and destination Operational issue units no longer match.');
    }
    if (transferLineSnapshot.exists()) {
      const existingLine = transferLineSnapshot.data();
      if (existingLine.tenantId !== tenantId || existingLine.sourceOrderLineId !== line.id || existingLine.quantityDispatched !== quantityUnits) throw new Error('An existing Operational transfer conflicts with this fulfilment quantity.');
      return;
    }
    const currentLine = orderLineSnapshot.data();
    if (currentLine.line_status !== 'sourcing' || currentLine.supplier_type || currentLine.qty_ordered !== line.qty_ordered) {
      throw new Error('This line has already been triaged or changed. Refresh the order before retrying.');
    }
    if (transferSnapshot.exists() || externalSnapshot.exists()) throw new Error('An existing Operational fulfilment split needs reconciliation before retrying.');
    const fulfillmentPlan = planOperationalOrderFulfillment({
      orderedPacks: Number(currentLine.qty_ordered || 0), internalPacks: quantityPacks,
      hqIssueUnits: Number(hqSnapshot.data().quantityInStock || 0), unitsPerPack
    });
    remainingExternalPacks = fulfillmentPlan.externalPacks;

    transaction.set(transferRef, {
      id: transferId, tenantId, inventoryClass: 'OPERATIONAL', fulfillmentSource: 'HQ_OPERATIONAL',
      transferNumber, sourceLocationId: 'HQ_OPERATIONAL', sourceBranchId: 'HQ',
      destinationBranchId: order.requesting_branch_id, destinationBranchName: order.requesting_branch_name,
      sourceOrderId: order.id, sourceOrderNumber: order.order_number, expectedLineCount: 1,
      remainingExternalPacks: fulfillmentPlan.externalPacks,
      totalValueUGX: quantityUnits * unitCostUGX, status: 'draft', dispatchedBy: actor.uid,
      dispatchedByName: actor.name, createdAt: now, updatedAt: now
    });
    transaction.set(transferLineRef, {
      id: transferLineId, tenantId, inventoryClass: 'OPERATIONAL', transferId,
      destinationBranchId: order.requesting_branch_id, masterItemId: master.id,
      sourceItemId: hqItem.id, destinationItemId: destinationItem.id,
      itemName: master.name, sourceOrderLineId: line.id, quantityDispatched: quantityUnits,
      unitOfIssue: master.unitOfIssue, unitCostUGX, totalValueUGX: quantityUnits * unitCostUGX,
      dispatchMovementId: `opm_${movementKeyForTransferLine(transferLineId, 'out')}`,
      receiptMovementId: `opm_${movementKeyForTransferLine(transferLineId, 'in')}`,
      status: 'prepared', createdAt: now, updatedAt: now
    });
    transaction.update(orderLineRef, {
      original_qty: Number(currentLine.qty_ordered || 0), qty_ordered: quantityPacks,
      supplier_id: 'HQ_OPERATIONAL', supplier_name: 'HQ Operational Store', supplier_type: 'internal_hq',
      line_total_ugx: 0, internal_fulfillment_transfer_id: transferId,
      internal_fulfilled_packs: quantityPacks, internal_fulfilled_units: quantityUnits,
      line_status: 'approved', updatedAt: now
    });
    if (fulfillmentPlan.externalPacks > 0) {
      transaction.set(externalLineRef, {
        ...currentLine, id: externalLineId, qty_ordered: fulfillmentPlan.externalPacks,
        original_qty: Number(currentLine.qty_ordered || 0), splitFromLineId: line.id,
        qty_received: 0, qty_received_units: 0, line_total_ugx: 0,
        supplier_id: null, supplier_name: null, supplier_type: null,
        line_status: 'sourcing', internal_fulfillment_transfer_id: transferId,
        createdAt: now, updatedAt: now
      });
    }
  });

  const preparedLine = await firestoreService.getDocument<OperationalTransferLine>('operational_transfer_lines', transferLineId);
  if (!preparedLine || preparedLine.tenantId !== tenantId || preparedLine.sourceOrderLineId !== line.id) throw new Error('The Operational transfer line could not be verified.');
  if (['dispatched', 'received', 'queried'].includes(preparedLine.status)) {
    return {
      transferId, transferNumber, quantityPacks,
      remainingExternalPacks: Math.max(0, Number(line.qty_ordered || 0) - quantityPacks),
      alreadyDispatched: true
    };
  }
  const dispatchResult = await dispatchPreparedOperationalHqTransfer({ tenantId, transferId, actor });
  return { transferId, transferNumber, quantityPacks, remainingExternalPacks: Math.max(0, remainingExternalPacks), alreadyDispatched: dispatchResult.alreadyDispatched };
}

export async function dispatchPreparedOperationalHqTransfer(input: {
  tenantId: string;
  transferId: string;
  actor: OperationalTransferActor;
}, connection: Firestore = db): Promise<{ alreadyDispatched: boolean }> {
  const { tenantId, transferId, actor } = input;
  const transfer = await readOperationalDocument<OperationalTransfer>(connection, 'operational_transfers', transferId);
  if (!transfer || transfer.tenantId !== tenantId || transfer.inventoryClass !== 'OPERATIONAL' || !['HQ_OPERATIONAL', 'HQ_DIRECT'].includes(transfer.fulfillmentSource || '')) {
    throw new Error('This is not a pending HQ Operational Store transfer.');
  }
  const lines = await readOperationalQuery<OperationalTransferLine>(connection, 'operational_transfer_lines', [
    { field: 'tenantId', operator: '==', value: tenantId },
    { field: 'transferId', operator: '==', value: transferId }
  ]);
  if (lines.length !== 1) throw new Error('The pending Operational Store transfer is incomplete and requires reconciliation.');
  const line = lines[0];
  if (['dispatched', 'received', 'queried'].includes(line.status)) return { alreadyDispatched: true };
  if (line.status !== 'prepared') throw new Error('The pending Operational transfer line is not ready to dispatch.');
  await postOperationalStoreMovement({
    tenantId, itemId: line.sourceItemId, quantityDelta: -line.quantityDispatched,
    movementType: 'TRANSFER_OUT', reference: transfer.transferNumber,
    idempotencyKey: movementKeyForTransferLine(line.id, 'out'), actorId: actor.uid,
    actorName: actor.name, sourceTransactionId: transferId, sourceLineId: line.id
  }, connection);
  const transferRef = doc(connection, 'operational_transfers', transferId);
  const lineRef = doc(connection, 'operational_transfer_lines', line.id);
  await runTransaction(connection, async transaction => {
    const [headerSnapshot, lineSnapshot] = await Promise.all([transaction.get(transferRef), transaction.get(lineRef)]);
    if (!headerSnapshot.exists() || !lineSnapshot.exists() || headerSnapshot.data().tenantId !== tenantId || lineSnapshot.data().tenantId !== tenantId) throw new Error('Operational transfer could not be finalized.');
    if (['dispatched', 'received', 'queried'].includes(lineSnapshot.data().status)) return;
    if (lineSnapshot.data().status !== 'prepared') throw new Error('Operational transfer line is no longer ready to dispatch.');
    const now = new Date().toISOString();
    transaction.update(lineRef, { status: 'dispatched', dispatchedBy: actor.uid, dispatchedAt: now, updatedAt: now });
    transaction.update(transferRef, { status: 'dispatched', dispatchedBy: actor.uid, dispatchedByName: actor.name, dispatchedAt: now, updatedAt: now });
    if (transfer.sourceOrderId) transaction.update(doc(connection, 'stock_orders', transfer.sourceOrderId), {
      status: Number(transfer.remainingExternalPacks || 0) > 0 ? 'sourcing' : 'dispatched',
      operational_transfer_id: transferId, updatedAt: now
    });
  });
  return { alreadyDispatched: false };
}

/** Posts an accepted receipt to the destination branch Operational ledger exactly once. */
export async function receiveOperationalTransferLine(input: ReceiveOperationalTransferLineInput, connection: Firestore = db): Promise<{ alreadyReceived: boolean }> {
  const { tenantId, transferId, line, actor, activeBranchId } = input;
  const accepted = Number(input.accepted);
  const queried = Number(input.queried);
  if (!tenantId || !actor.uid || !activeBranchId || activeBranchId === 'HQ') throw new Error('Tenant, receiving branch and user are required.');
  if (!Number.isFinite(accepted) || !Number.isFinite(queried) || accepted < 0 || queried < 0 || accepted + queried !== line.quantityDispatched) {
    throw new Error('Accepted plus queried quantity must equal the dispatched quantity.');
  }
  if (queried > 0 && !input.queryReason?.trim()) throw new Error('A reason is required for queried Operational stock.');

  const transferRef = doc(connection, 'operational_transfers', transferId);
  const lineRef = doc(connection, 'operational_transfer_lines', line.id);
  const itemRef = doc(connection, 'operational_inventory', line.destinationItemId);
  const masterRef = doc(connection, 'operational_inventory_masters', line.masterItemId);
  const settingsRef = doc(connection, 'system_settings', tenantId);
  const movementKey = movementKeyForTransferLine(line.id, 'in');
  const movementRef = doc(connection, 'operational_inventory_movements', `opm_${movementKey}`);
  const now = new Date().toISOString();

  const result = await runTransaction(connection, async transaction => {
    const [settingsSnapshot, transferSnapshot, lineSnapshot, itemSnapshot, masterSnapshot, movementSnapshot] = await Promise.all([
      transaction.get(settingsRef), transaction.get(transferRef), transaction.get(lineRef),
      transaction.get(itemRef), transaction.get(masterRef), transaction.get(movementRef)
    ]);
    assertOperationalEnabled(settingsSnapshot.data(), tenantId);
    if (!transferSnapshot.exists() || transferSnapshot.data().tenantId !== tenantId || transferSnapshot.data().inventoryClass !== 'OPERATIONAL' || transferSnapshot.data().destinationBranchId !== activeBranchId) throw new Error('This Operational transfer is not assigned to the active branch.');
    if (!lineSnapshot.exists() || lineSnapshot.data().tenantId !== tenantId || lineSnapshot.data().transferId !== transferId || lineSnapshot.data().masterItemId !== line.masterItemId) throw new Error('The Operational transfer line is invalid.');
    if (!['dispatched', 'queried', 'received'].includes(lineSnapshot.data().status)) throw new Error('Only a dispatched Operational line can be received.');
    if (!itemSnapshot.exists() || itemSnapshot.data().tenantId !== tenantId || itemSnapshot.data().branchId !== activeBranchId || itemSnapshot.data().inventoryClass !== 'OPERATIONAL' || itemSnapshot.data().masterItemId !== line.masterItemId) throw new Error('The destination Operational stock record is missing or mismatched.');
    if (!masterSnapshot.exists() || masterSnapshot.data().tenantId !== tenantId || masterSnapshot.data().inventoryClass !== 'OPERATIONAL') throw new Error('The Operational master identity is invalid.');

    if (['received', 'queried'].includes(lineSnapshot.data().status)) {
      if (Number(lineSnapshot.data().quantityAccepted || 0) !== accepted || Number(lineSnapshot.data().quantityQueried || 0) !== queried || lineSnapshot.data().queryReason !== (input.queryReason?.trim() || undefined)) {
        throw new Error('This Operational transfer line already has a different receipt record.');
      }
      return { alreadyReceived: true };
    }
    if (!['dispatched', 'partially_received'].includes(transferSnapshot.data().status)) throw new Error('The Operational transfer is not awaiting branch receipt.');

    if (accepted > 0) {
      if (movementSnapshot.exists()) throw new Error('A branch receipt movement already exists for this line. Reconcile the transfer before retrying.');
      const before = Number(itemSnapshot.data().quantityInStock || 0);
      const after = before + accepted;
      const movement = {
        tenantId, inventoryClass: 'OPERATIONAL', itemId: itemRef.id, masterItemId: line.masterItemId,
        itemName: line.itemName, locationId: `BRANCH_${activeBranchId}`, branchId: activeBranchId, movementType: 'TRANSFER_IN',
        quantityDelta: accepted, balanceBefore: before, balanceAfter: after,
        unitCostUGX: line.unitCostUGX, totalValueUGX: accepted * line.unitCostUGX,
        reference: transferSnapshot.data().transferNumber, idempotencyKey: movementKey,
        actorId: actor.uid, actorName: actor.name, sourceTransactionId: transferId,
        sourceLineId: line.id, createdAt: now
      };
      transaction.update(itemRef, { quantityInStock: after, lastMovementId: `opm_${movementKey}`, updatedAt: now });
      transaction.set(movementRef, movement);
    }
    transaction.update(lineRef, {
      status: queried > 0 ? 'queried' : 'received', quantityAccepted: accepted,
      quantityQueried: queried, ...(queried > 0 ? { queryReason: input.queryReason!.trim() } : {}),
      receivedBy: actor.uid, receivedAt: now, updatedAt: now
    });
    transaction.update(transferRef, { status: 'partially_received', updatedAt: now });
    return { alreadyReceived: false };
  });

  const lines = await readOperationalQuery<OperationalTransferLine>(connection, 'operational_transfer_lines', [
    { field: 'tenantId', operator: '==', value: tenantId },
    { field: 'transferId', operator: '==', value: transferId },
    { field: 'destinationBranchId', operator: '==', value: activeBranchId }
  ]);
  if (lines.length > 0 && lines.every(item => ['received', 'queried'].includes(item.status))) {
    let orderResolved = false;
    let orderHasQueries = lines.some(item => item.status === 'queried');
    const headerBeforeFinalize = await readOperationalDocument<OperationalTransfer>(connection, 'operational_transfers', transferId);
    if (headerBeforeFinalize?.sourceOrderId) {
      const orderLines = await readOperationalQuery<StockOrderLine>(connection, 'stock_order_lines', [
        { field: 'tenantId', operator: '==', value: tenantId },
        { field: 'order_id', operator: '==', value: headerBeforeFinalize.sourceOrderId }
      ]);
      const resolutions = await Promise.all(orderLines.map(async orderLine => {
        if (orderLine.supplier_type === 'internal_hq' && orderLine.internal_fulfillment_transfer_id) {
          if (orderLine.internal_fulfillment_transfer_id === transferId) return true;
          const relatedTransfer = await readOperationalDocument<OperationalTransfer>(connection, 'operational_transfers', orderLine.internal_fulfillment_transfer_id);
          if (relatedTransfer?.status === 'queried') orderHasQueries = true;
          return Boolean(relatedTransfer && ['received', 'queried'].includes(relatedTransfer.status));
        }
        if (orderLine.supplier_type === 'external' && orderLine.operational_external_transfer_id) {
          if (orderLine.operational_external_transfer_id === transferId) {
            if (lines.some(item => item.status === 'queried')) orderHasQueries = true;
            return true;
          }
          const externalTransfer = await readOperationalDocument<OperationalTransfer>(connection, 'operational_transfers', orderLine.operational_external_transfer_id);
          if (externalTransfer?.status === 'queried') orderHasQueries = true;
          return Boolean(externalTransfer && ['received', 'queried'].includes(externalTransfer.status));
        }
        if (orderLine.line_status === 'queried') orderHasQueries = true;
        return orderLine.line_status === 'unsupplied';
      }));
      orderResolved = resolutions.length > 0 && resolutions.every(Boolean);
    }
    await runTransaction(connection, async transaction => {
      const header = await transaction.get(transferRef);
      if (!header.exists() || header.data().tenantId !== tenantId || header.data().destinationBranchId !== activeBranchId) throw new Error('The Operational transfer header changed before receipt completion.');
      if (['received', 'queried'].includes(header.data().status)) return;
      transaction.update(transferRef, {
        status: lines.some(item => item.status === 'queried') ? 'queried' : 'received', receivedBy: actor.uid,
        receivedByName: actor.name, receivedAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      });
      if (header.data().sourceOrderId && orderResolved) {
        transaction.update(doc(connection, 'stock_orders', header.data().sourceOrderId), {
          status: orderHasQueries ? 'queried' : 'received', received_by: actor.uid,
          received_at: new Date().toISOString(), updatedAt: new Date().toISOString()
        });
      }
    });
  }
  return result;
}
