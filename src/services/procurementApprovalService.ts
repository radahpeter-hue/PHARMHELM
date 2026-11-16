import {
  collection, deleteField, doc, getDocFromServer, getDocsFromServer, query, runTransaction, where,
  type DocumentData, type Firestore
} from 'firebase/firestore';
import { db } from '../firebase';
import type { StockOrder, StockOrderLine } from '../types';
import { isOperationalInventoryRecord } from './inventoryClassification';
import { supplierEligibleForStream } from './supplierRegistryPolicy';
import {
  planProcurementApproval, type ApprovalAddition, type ApprovalQuantityEdit
} from './procurementApprovalPolicy';

export interface ConfirmProcurementApprovalInput {
  order: StockOrder;
  tenantId: string;
  actorId: string;
  edits: Record<string, ApprovalQuantityEdit>;
  additions: ApprovalAddition[];
}

export interface ConfirmProcurementApprovalResult {
  approvedTotalUGX: number;
  addedCount: number;
  unsuppliedCount: number;
}

type ApprovalWrite = {
  lineId: string;
  data: DocumentData;
  before?: {
    qty: number;
    productId: string;
    unitCost: number;
    supplierId: string;
  };
  unsupplied?: DocumentData;
};

type PendingApproval = {
  id: string;
  next: number;
  writes: ApprovalWrite[];
  audit: DocumentData;
  result: ConfirmProcurementApprovalResult;
};

const approvalChanged = 'This order changed during financial approval. Reopen it from Financial Approval.';

function assertLiveOrder(data: DocumentData | undefined, order: StockOrder, tenantId: string) {
  if (!data || data.tenantId !== tenantId || data.status !== 'awaiting_finance_approval'
      || data.category !== order.category || data.requesting_branch_id !== order.requesting_branch_id) {
    throw new Error(approvalChanged);
  }
  return data;
}

async function applyApproval(
  order: StockOrder, tenantId: string, actorId: string, approvalId: string, connection: Firestore
): Promise<ConfirmProcurementApprovalResult> {
  const orderRef = doc(connection, 'stock_orders', order.id);
  const auditRef = doc(connection, 'procurement_approval_audit', `approval_${order.id}`);
  for (;;) {
    const finished = await runTransaction(connection, async transaction => {
      const orderSnapshot = await transaction.get(orderRef);
      const current = orderSnapshot.data();
      if (current?.tenantId === tenantId && current.approval_operation_id === approvalId
          && current.approval_audit_id === auditRef.id) {
        const audit = await transaction.get(auditRef);
        if (audit.exists()) return audit.data().result as ConfirmProcurementApprovalResult;
      }
      const live = assertLiveOrder(current, order, tenantId);
      const pending = live.approvalSave as PendingApproval | undefined;
      if (pending?.id !== approvalId) throw new Error(approvalChanged);

      if (pending.next === pending.writes.length) {
        const now = new Date().toISOString();
        transaction.update(orderRef, {
          status: 'approved', total_order_value_ugx: pending.result.approvedTotalUGX,
          approved_at: now, approved_by: actorId, approval_revision: 1, approval_audit_id: auditRef.id,
          approval_operation_id: pending.id, updatedAt: now, approvalSave: deleteField()
        });
        transaction.set(auditRef, {
          ...pending.audit, actorId, approvedAt: now, result: pending.result
        });
        return pending.result;
      }

      const write = pending.writes[pending.next];
      // Keep the unsupplied write within its own rule budget. Its stable ID makes
      // it safe to resume here, and the log is hidden until the audit is published.
      if (write.unsupplied) {
        const unsuppliedRef = doc(connection, 'unsupplied_lines', `${auditRef.id}_${write.lineId}`);
        const unsupplied = await transaction.get(unsuppliedRef);
        if (!unsupplied.exists()) {
          transaction.set(unsuppliedRef, write.unsupplied);
          return null;
        }
        if (unsupplied.data().approval_audit_id !== auditRef.id
            || unsupplied.data().qty_unsupplied !== write.unsupplied.qty_unsupplied) throw new Error(approvalChanged);
      }
      const ref = doc(connection, 'stock_order_lines', write.lineId);
      if (write.before) {
        const source = (await transaction.get(ref)).data();
        const expected = write.before;
        if (!source || source.tenantId !== tenantId || source.order_id !== order.id
            || source.line_status !== 'awaiting_finance_approval' || source.qty_ordered !== expected.qty
            || source.product_id !== expected.productId || source.unit_cost_ugx !== expected.unitCost
            || (source.supplier_id || '') !== expected.supplierId) throw new Error(approvalChanged);
        transaction.update(ref, { ...write.data, approval_operation_id: pending.id });
      } else {
        transaction.set(ref, { ...write.data, approval_operation_id: pending.id });
      }
      transaction.update(orderRef, { 'approvalSave.next': pending.next + 1 });
      return null;
    });
    if (finished) return finished;
  }
}

export async function resumeProcurementApproval(
  order: StockOrder, tenantId: string, actorId: string, connection: Firestore = db
): Promise<ConfirmProcurementApprovalResult> {
  if (!actorId || !tenantId || tenantId !== order.tenantId || !order.id) throw new Error('Invalid approval identity.');
  const current = (await getDocFromServer(doc(connection, 'stock_orders', order.id))).data();
  const live = assertLiveOrder(current, order, tenantId);
  const pending = live.approvalSave as PendingApproval | undefined;
  if (!pending) throw new Error(approvalChanged);
  return applyApproval(order, tenantId, actorId, pending.id, connection);
}

export async function confirmProcurementApproval(
  input: ConfirmProcurementApprovalInput,
  connection: Firestore = db
): Promise<ConfirmProcurementApprovalResult> {
  const { order, tenantId, actorId, edits, additions } = input;
  if (!actorId || !tenantId || tenantId !== order.tenantId || !order.id) throw new Error('Invalid approval identity.');
  if (order.status !== 'awaiting_finance_approval') throw new Error('This order is no longer awaiting financial approval.');

  const operational = isOperationalInventoryRecord(order);
  const inventoryClass = operational ? 'OPERATIONAL' : 'SELLABLE';
  const candidateLines = await getDocsFromServer(query(
    collection(connection, 'stock_order_lines'),
    where('tenantId', '==', tenantId), where('order_id', '==', order.id)
  ));
  const existingRefs = candidateLines.docs.map(snapshot => snapshot.ref);
  const candidatesById = new Map(candidateLines.docs.map(snapshot => [snapshot.id, snapshot.data()]));
  const addedRefs = additions.map(() => doc(collection(connection, 'stock_order_lines')));
  const productRefs = additions.map(a => doc(connection, operational ? 'operational_inventory' : 'products', a.productId));
  const supplierRefs = additions.map(a => doc(connection, 'supplier_registry', a.supplierId));
  const orderRef = doc(connection, 'stock_orders', order.id);
  const auditRef = doc(connection, 'procurement_approval_audit', `approval_${order.id}`);
  const now = new Date().toISOString();

  const approvalId = doc(collection(connection, 'stock_orders')).id;
  await runTransaction(connection, async transaction => {
    const [orderSnap, auditSnap] = await Promise.all([transaction.get(orderRef), transaction.get(auditRef)]);
    const current = assertLiveOrder(orderSnap.data(), order, tenantId);
    if (current.approvalSave) throw new Error('Approval is already in progress. Reopen it to resume the confirmed review.');
    if (auditSnap.exists()) throw new Error('This order has an existing financial approval audit. Reconcile before retrying.');
    const [lineSnapshots, productSnapshots, supplierSnapshots] = await Promise.all([
      Promise.all(existingRefs.map(ref => transaction.get(ref))),
      Promise.all(productRefs.map(ref => transaction.get(ref))),
      Promise.all(supplierRefs.map(ref => transaction.get(ref)))
    ]);
    if (lineSnapshots.some(snapshot => !snapshot.exists())) throw new Error('Order lines changed during review.');
    const liveLines = lineSnapshots.map(snapshot => ({ ...snapshot.data(), id: snapshot.id } as StockOrderLine));
    for (const line of liveLines) {
      const candidate = candidatesById.get(line.id);
      if (!candidate || candidate.qty_ordered !== line.qty_ordered ||
          candidate.line_status !== line.line_status || candidate.unit_cost_ugx !== line.unit_cost_ugx ||
          candidate.product_id !== line.product_id || candidate.supplier_id !== line.supplier_id) {
        throw new Error('Order lines were modified during review. Reopen the approval editor.');
      }
    }
    const liveOrder = { ...order, ...orderSnap.data(), id: order.id } as StockOrder;
    const plan = planProcurementApproval(liveOrder, liveLines, edits, additions);
    const addedLineData: DocumentData[] = [];
    for (let i = 0; i < additions.length; i++) {
      const addition = additions[i];
      const p = productSnapshots[i];
      const s = supplierSnapshots[i];
      if (!p.exists() || p.data().tenantId !== tenantId) throw new Error('An added product is not in this tenant inventory master.');
      if (!s.exists() || s.data().tenantId !== tenantId || !supplierEligibleForStream(s.data(), inventoryClass)) {
        throw new Error('An added product has an invalid supplier or an unsupported supplier capability.');
      }
      const item = p.data();
      if (operational) {
        if (item.inventoryClass !== 'OPERATIONAL' || item.branchId !== order.requesting_branch_id || !item.masterItemId) {
          throw new Error('Select an Operational master-linked item registered at the requesting branch.');
        }
      } else if (item.inventoryClass === 'OPERATIONAL' || item.isOperational === true || item.category === 'non_sellable') {
        throw new Error('Operational products cannot be added to a Sellable requisition.');
      }
      const quotedValue = addition.quantity * addition.unitCostUGX;
      addedLineData.push({
        tenantId, order_id: order.id, inventoryClass,
        product_id: p.id, product_name: item.name,
        ...(operational ? { masterItemId: item.masterItemId, isOperational: true } : {}),
        qty_ordered: addition.quantity,
        qty_received: 0,
        unit_cost_ugx: addition.unitCostUGX,
        quoted_price_ugx: addition.unitCostUGX,
        line_total_ugx: quotedValue,
        supplier_id: s.id, supplier_name: s.data().supplier_name,
        supplier_type: 'external', line_status: 'approved',
        added_during_finance_approval: true,
        approval_reason: addition.reason.trim(),
        ...(addition.replacesLineId ? { replaces_order_line_id: addition.replacesLineId } : {}),
        createdAt: now, updatedAt: now
      });
    }
    const changeRows = [];
    const writes: ApprovalWrite[] = [];
    const linesById = new Map(liveLines.map(line => [line.id, line]));
    let unsuppliedCount = 0;
    for (const change of plan.changes) {
      const line = linesById.get(change.lineId)!;
      const originalRequested = line.original_qty ?? change.originalQty;
      const write: ApprovalWrite = {
        lineId: line.id,
        before: {
          qty: line.qty_ordered, productId: line.product_id,
          unitCost: line.unit_cost_ugx, supplierId: line.supplier_id || ''
        },
        data: {
          original_qty: originalRequested,
          qty_ordered: change.approvedQty,
          line_total_ugx: change.approvedQty * change.unitCostUGX,
          line_status: change.approvedQty === 0 ? 'unsupplied' : 'approved',
          updatedAt: now,
          ...(change.replacement ? { substituted_by_product_id: change.replacement.productId } : {})
        }
      };
      if (change.removedQty > 0) {
        unsuppliedCount++;
        const replacement = change.replacement;
        write.unsupplied = {
          tenantId, inventoryClass, order_id: order.id, original_line_id: line.id,
          product_id: line.product_id, product_name: line.product_name,
          qty_unsupplied: change.removedQty,
          reason: replacement ? 'Substituted during financial approval' : 'Reduced or removed during financial approval',
          status: 'pending', approval_audit_id: auditRef.id,
          ...(replacement ? { replacement_product_id: replacement.productId, replacement_order_line_id: addedRefs[additions.indexOf(replacement)].id } : {}),
          createdAt: now
        };
      }
      writes.push(write);
      changeRows.push({
        lineId: line.id, productId: line.product_id,
        originallyRequested: originalRequested, beforeApproval: change.originalQty,
        approvedQty: change.approvedQty, removedQty: change.removedQty,
        substitutionProductId: change.replacement?.productId || null
      });
    }
    for (const [index, data] of addedLineData.entries()) writes.push({ lineId: addedRefs[index].id, data });
    const audit = {
      tenantId, orderId: order.id, orderNumber: order.order_number, initiatedBy: actorId,
      initiatedAt: now, inventoryClass, initialTotalUGX: Number(current.total_order_value_ugx || 0),
      approvedTotalUGX: plan.approvedTotalUGX, changes: changeRows,
      additions: additions.map((addition, index) => ({
        lineId: addedRefs[index].id, productId: addition.productId,
        quantity: addition.quantity, unitCostUGX: addition.unitCostUGX,
        supplierId: addition.supplierId, reason: addition.reason,
        replacesLineId: addition.replacesLineId || null
      }))
    };
    const result = { approvedTotalUGX: plan.approvedTotalUGX, addedCount: addedLineData.length, unsuppliedCount };
    const save: PendingApproval = { id: approvalId, next: 0, writes, audit, result };
    if (new TextEncoder().encode(JSON.stringify(save)).length > 600_000) {
      throw new Error('This approval contains too much line data to save.');
    }
    transaction.update(orderRef, { approvalSave: save });
  });
  return applyApproval(order, tenantId, actorId, approvalId, connection);
}
