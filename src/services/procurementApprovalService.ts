import {
  collection, doc, getDocs, query, runTransaction, where, type Firestore
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

/**
 * Finalize an edited order and all of its line changes in one atomic commit.
 * Finance approval is a single event; GRN must use these persisted approved lines.
 * No stock, invoices, payments or dispatch records are written here.
 */
export async function confirmProcurementApproval(
  input: ConfirmProcurementApprovalInput,
  connection: Firestore = db
): Promise<ConfirmProcurementApprovalResult> {
  const { order, tenantId, actorId, edits, additions } = input;
  if (!actorId || !tenantId || tenantId !== order.tenantId || !order.id) throw new Error('Invalid approval identity.');
  if (order.status !== 'awaiting_finance_approval') throw new Error('This order is no longer awaiting financial approval.');

  const operational = isOperationalInventoryRecord(order);
  const inventoryClass = operational ? 'OPERATIONAL' : 'SELLABLE';
  const candidateLines = await getDocs(query(
    collection(connection, 'stock_order_lines'),
    where('tenantId', '==', tenantId), where('order_id', '==', order.id)
  ));
  const existingRefs = candidateLines.docs.map(snapshot => doc(connection, 'stock_order_lines', snapshot.id));
  const addedRefs = additions.map(() => doc(collection(connection, 'stock_order_lines')));
  const productRefs = additions.map(a => doc(connection, operational ? 'operational_inventory' : 'products', a.productId));
  const supplierRefs = additions.map(a => doc(connection, 'supplier_registry', a.supplierId));
  const masterRefs = operational ? additions.map(a => {
    const product = a.productId;
    const option = input.additions.find(candidate => candidate.productId === product);
    // The master identity is established from the live Operational location row below.
    return option;
  }) : [];
  void masterRefs;
  const orderRef = doc(connection, 'stock_orders', order.id);
  const auditRef = doc(connection, 'procurement_approval_audit', `approval_${order.id}`);
  const now = new Date().toISOString();

  return runTransaction(connection, async transaction => {
    const [orderSnap, auditSnap, lineSnapshots, productSnapshots, supplierSnapshots] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(auditRef),
      Promise.all(existingRefs.map(ref => transaction.get(ref))),
      Promise.all(productRefs.map(ref => transaction.get(ref))),
      Promise.all(supplierRefs.map(ref => transaction.get(ref)))
    ]);
    if (!orderSnap.exists() || orderSnap.data().tenantId !== tenantId ||
        orderSnap.data().status !== 'awaiting_finance_approval' ||
        orderSnap.data().category !== order.category ||
        orderSnap.data().requesting_branch_id !== order.requesting_branch_id) {
      throw new Error('The order changed while you were reviewing it. Reopen Financial Approval.');
    }
    if (auditSnap.exists()) throw new Error('This order has an existing financial approval audit. Reconcile before retrying.');
    if (lineSnapshots.some(snapshot => !snapshot.exists())) throw new Error('Order lines changed during review.');
    const liveLines = lineSnapshots.map(snapshot => ({ id: snapshot.id, ...snapshot.data() } as StockOrderLine));
    for (const line of liveLines) {
      const candidate = candidateLines.docs.find(snapshot => snapshot.id === line.id)?.data();
      if (!candidate || candidate.qty_ordered !== line.qty_ordered ||
          candidate.line_status !== line.line_status || candidate.unit_cost_ugx !== line.unit_cost_ugx ||
          candidate.product_id !== line.product_id) {
        throw new Error('Order lines were modified during review. Reopen the approval editor.');
      }
    }
    const liveOrder = { ...order, ...orderSnap.data(), id: order.id } as StockOrder;
    const plan = planProcurementApproval(liveOrder, liveLines, edits, additions);
    const newLineData = [];
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
      newLineData.push({
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
    let unsuppliedCount = 0;
    for (const change of plan.changes) {
      const index = liveLines.findIndex(line => line.id === change.lineId);
      const line = liveLines[index];
      const originalRequested = line.original_qty ?? change.originalQty;
      transaction.update(existingRefs[index], {
        original_qty: originalRequested,
        qty_ordered: change.approvedQty,
        line_total_ugx: change.approvedQty * change.unitCostUGX,
        line_status: change.approvedQty === 0 ? 'unsupplied' : 'approved',
        updatedAt: now,
        ...(change.replacement ? { substituted_by_product_id: change.replacement.productId } : {})
      });
      if (change.removedQty > 0) {
        unsuppliedCount++;
        const replacement = change.replacement;
        transaction.set(doc(connection, 'unsupplied_lines', `approval_${order.id}_${line.id}`), {
          tenantId, inventoryClass, order_id: order.id, original_line_id: line.id,
          product_id: line.product_id, product_name: line.product_name,
          qty_unsupplied: change.removedQty,
          reason: replacement ? 'Substituted during financial approval' : 'Reduced or removed during financial approval',
          status: 'pending',
          ...(replacement ? { replacement_product_id: replacement.productId, replacement_order_line_id: addedRefs[additions.indexOf(replacement)].id } : {}),
          createdAt: now
        });
      }
      changeRows.push({
        lineId: line.id, productId: line.product_id,
        originallyRequested: originalRequested, beforeApproval: change.originalQty,
        approvedQty: change.approvedQty, removedQty: change.removedQty,
        substitutionProductId: change.replacement?.productId || null
      });
    }
    for (let i = 0; i < newLineData.length; i++) transaction.set(addedRefs[i], newLineData[i]);
    transaction.update(orderRef, {
      status: 'approved', total_order_value_ugx: plan.approvedTotalUGX,
      approved_at: now, approved_by: actorId,
      approval_revision: 1, approval_audit_id: auditRef.id, updatedAt: now
    });
    transaction.set(auditRef, {
      tenantId, orderId: order.id, orderNumber: order.order_number,
      actorId, approvedAt: now,
      inventoryClass, initialTotalUGX: Number(orderSnap.data().total_order_value_ugx || 0),
      approvedTotalUGX: plan.approvedTotalUGX, changes: changeRows,
      additions: additions.map((addition, index) => ({
        lineId: addedRefs[index].id, productId: addition.productId,
        quantity: addition.quantity, unitCostUGX: addition.unitCostUGX,
        supplierId: addition.supplierId, reason: addition.reason,
        replacesLineId: addition.replacesLineId || null
      }))
    });
    return { approvedTotalUGX: plan.approvedTotalUGX, addedCount: additions.length, unsuppliedCount };
  });
}
