import type { StockOrder, StockOrderLine } from '../types';

export interface ApprovalQuantityEdit {
  qty: number;
  removed: boolean;
}

export interface ApprovalAddition {
  productId: string;
  quantity: number;
  unitCostUGX: number;
  supplierId: string;
  supplierName: string;
  /** Original order line explicitly replaced by this product, if any. */
  replacesLineId?: string;
  reason: string;
}

export interface ApprovalLineChange {
  lineId: string;
  originalQty: number;
  approvedQty: number;
  unitCostUGX: number;
  removedQty: number;
  replacement?: ApprovalAddition;
}

export interface ApprovalPlan {
  changes: ApprovalLineChange[];
  additions: ApprovalAddition[];
  retainedLines: StockOrderLine[];
  approvedTotalUGX: number;
}

const validWholeQuantity = (value: number) => Number.isSafeInteger(value) && value >= 0;
const validMoney = (value: number) => Number.isSafeInteger(value) && value >= 0;

/**
 * Pure approval planner. The database transaction still verifies every live
 * order line, product, and supplier before any document is written.
 */
export function planProcurementApproval(
  order: StockOrder,
  lines: StockOrderLine[],
  edits: Record<string, ApprovalQuantityEdit>,
  additions: ApprovalAddition[]
): ApprovalPlan {
  if (order.status !== 'awaiting_finance_approval') throw new Error('Only orders awaiting financial approval may be edited.');
  if (lines.length > 150 || additions.length > 40) throw new Error('This approval is too large to process safely in one transaction.');
  const editable = lines.filter(line => line.line_status === 'awaiting_finance_approval');
  if (editable.length === 0) throw new Error('No sourced order lines are awaiting financial approval.');
  if (editable.some(line => line.order_id !== order.id || line.tenantId !== order.tenantId)) {
    throw new Error('Order line ownership does not match the selected order.');
  }
  const activeLines = lines.filter(line => line.line_status !== 'unsupplied' && line.line_status !== 'rejected' && line.line_status !== 'deferred');
  const productIds = new Set(activeLines.map(line => line.product_id));
  const replacementByLine = new Map<string, ApprovalAddition>();
  const uniqueProducts = new Set<string>();

  for (const addition of additions) {
    if (!addition.productId || !addition.supplierId || !addition.supplierName.trim() || !addition.reason.trim()) {
      throw new Error('Every added product needs a supplier and a reason for its addition.');
    }
    if (!validWholeQuantity(addition.quantity) || addition.quantity === 0 || !validMoney(addition.unitCostUGX) || addition.unitCostUGX === 0) {
      throw new Error('Added products need a positive whole-pack quantity and a positive quoted unit cost.');
    }
    if (productIds.has(addition.productId) || uniqueProducts.has(addition.productId)) {
      throw new Error('A product already exists on the active order. Edit that line instead of adding a duplicate.');
    }
    uniqueProducts.add(addition.productId);
    if (addition.replacesLineId) {
      const replacedLine = editable.find(line => line.id === addition.replacesLineId);
      if (!replacedLine) throw new Error('The substituted product must reference an editable line on this order.');
      if (replacementByLine.has(addition.replacesLineId)) throw new Error('Only one replacement may be assigned to a removed order line.');
      if (!edits[addition.replacesLineId]?.removed && edits[addition.replacesLineId]?.qty !== 0) {
        throw new Error('The original product must be removed before approving its substitute.');
      }
      replacementByLine.set(addition.replacesLineId, addition);
    }
  }

  const changes = editable.map(line => {
    const edit = edits[line.id];
    if (!edit) throw new Error(`Approval quantity was not confirmed for ${line.product_name}.`);
    const originalQty = Number(line.qty_ordered);
    const approvedQty = edit.removed ? 0 : Number(edit.qty);
    if (!validWholeQuantity(originalQty) || !validWholeQuantity(approvedQty)) {
      throw new Error(`Invalid approved quantity for ${line.product_name}.`);
    }
    if (!validMoney(Number(line.unit_cost_ugx))) throw new Error('Invalid sourced unit cost.');
    return {
      lineId: line.id,
      originalQty,
      approvedQty,
      unitCostUGX: Number(line.unit_cost_ugx),
      removedQty: Math.max(0, originalQty - approvedQty),
      replacement: replacementByLine.get(line.id)
    };
  });

  const retainedLines = lines.filter(line => line.line_status === 'approved' && !editable.some(editableLine => editableLine.id === line.id));
  let approvedTotalUGX = 0;
  for (const change of changes) approvedTotalUGX += change.approvedQty * change.unitCostUGX;
  for (const addition of additions) approvedTotalUGX += addition.quantity * addition.unitCostUGX;
  for (const line of retainedLines) approvedTotalUGX += Number(line.line_total_ugx || 0);
  if (!Number.isSafeInteger(approvedTotalUGX) || approvedTotalUGX < 0 || approvedTotalUGX === 0) {
    throw new Error('An approved order must have a valid, nonzero total.');
  }
  return { changes, additions, retainedLines, approvedTotalUGX };
}
