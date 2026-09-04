import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  Timestamp,
  where
} from 'firebase/firestore';
import { db } from '../firebase';
import { StockOrder, StockOrderLine } from '../types';

export type GrnLineEdit = { qty: number; removed: boolean; batch: string; expiry: string };

export interface ProcessGrnInput {
  tenantId: string;
  order: StockOrder;
  lines: StockOrderLine[];
  editedLines: Record<string, GrnLineEdit>;
  paymentType: 'cash' | 'credit';
  invoiceNumber: string;
  invoiceDate: string;
  inputVat: number;
  whtAmount: number;
  notes: string;
  user: { uid: string; name: string };
}

export interface ProcessGrnResult {
  grnId: string;
  grnNumber: string;
  invoiceId: string | null;
  creditId: string | null;
  transferId: string | null;
  alreadyProcessed: boolean;
}

const stablePart = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);

export const procurementPostingIds = (tenantId: string, orderId: string) => {
  const key = stablePart(`${tenantId}_${orderId}`);
  return {
    grnId: `grn_${key}`,
    invoiceId: `procurement_invoice_${key}`,
    procurementInvoiceId: `procurement_register_${key}`,
    creditId: `supplier_credit_${key}`,
    pettyCashId: `cash_grn_${key}`,
    transferId: `grn_dispatch_${key}`,
    auditId: `grn_financial_posting_${key}`
  };
};

const toTimestamp = (date: string) => {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error('A valid invoice date is required.');
  return Timestamp.fromDate(parsed);
};

/**
 * Posts a procurement GRN, its Finance representation and its dispatch as one
 * idempotent Firestore transaction. Deterministic document IDs make a retry a
 * no-op after success and allow a missing member of an older partial posting to
 * be repaired without creating a second liability.
 */
export async function processProcurementGrn(input: ProcessGrnInput): Promise<ProcessGrnResult> {
  const { tenantId, order, lines, editedLines, paymentType, user } = input;
  if (!tenantId || !order.id) throw new Error('The tenant and stock order are required.');
  if (!input.invoiceNumber.trim()) throw new Error('The supplier invoice number is required.');
  if (lines.length > 150) throw new Error('This GRN is too large for one atomic posting. Split it into GRNs of 150 product lines or fewer.');

  const invoiceTimestamp = toTimestamp(input.invoiceDate);
  const dueDate = Timestamp.fromDate(new Date(invoiceTimestamp.toDate().getTime() + 30 * 86400000));
  const now = Timestamp.now();
  const ids = procurementPostingIds(tenantId, order.id);
  const grnNumber = `GRN-${input.invoiceDate.slice(0, 4)}-${stablePart(order.order_number || order.id).toUpperCase()}`;

  const receivedItems: any[] = [];
  const financeItems: any[] = [];
  const unsupplied: Array<{ id: string; data: any }> = [];
  const lineUpdates: Array<{ id: string; data: any }> = [];
  let financeValue = 0;
  let transferValue = 0;

  for (const line of lines) {
    const edit = editedLines[line.id];
    if (!edit) continue;
    if (edit.removed || edit.qty === 0) {
      lineUpdates.push({ id: line.id, data: { qty_ordered: 0, line_status: 'unsupplied', updatedAt: now } });
      unsupplied.push({
        id: `${ids.grnId}_${stablePart(line.id)}`,
        data: {
          tenantId, order_id: order.id, grn_id: ids.grnId, original_line_id: line.id,
          product_id: line.product_id, product_name: line.product_name || 'Unknown',
          qty_unsupplied: line.qty_ordered, reason: 'Removed during GRN processing',
          status: 'pending', createdAt: now
        }
      });
      continue;
    }
    if (!Number.isFinite(edit.qty) || edit.qty < 0 || edit.qty > line.qty_ordered) {
      throw new Error(`Received quantity is invalid for ${line.product_name || line.product_id}.`);
    }
    if (!edit.batch.trim()) throw new Error(`Batch number is required for ${line.product_name || line.product_id}.`);
    if (!edit.expiry) throw new Error(`Expiry date is required for ${line.product_name || line.product_id}.`);
    if (new Date(`${edit.expiry}T23:59:59`).getTime() <= Date.now()) {
      throw new Error(`Expiry date must be in the future for ${line.product_name || line.product_id}.`);
    }

    if (edit.qty < line.qty_ordered) {
      unsupplied.push({
        id: `${ids.grnId}_${stablePart(line.id)}`,
        data: {
          tenantId, order_id: order.id, grn_id: ids.grnId, original_line_id: line.id,
          product_id: line.product_id, product_name: line.product_name || 'Unknown',
          qty_unsupplied: line.qty_ordered - edit.qty, reason: 'Quantity reduced during GRN processing',
          status: 'pending', createdAt: now
        }
      });
    }

    const item = {
      line_id: line.id,
      product_id: line.product_id,
      product_name: line.product_name || 'Unknown Product',
      qty_ordered: line.qty_ordered,
      qty_received: edit.qty,
      unit_cost_ugx: line.unit_cost_ugx || 0,
      total_cost_ugx: edit.qty * (line.unit_cost_ugx || 0),
      batch_number: edit.batch.trim(),
      expiry_date: edit.expiry,
      status: 'received'
    };
    receivedItems.push(item);
    transferValue += item.total_cost_ugx;
    const external = line.supplier_type !== 'internal_hq' && line.supplier_type !== 'internal_warehouse';
    if (external) {
      financeItems.push(item);
      financeValue += item.total_cost_ugx;
    }
    lineUpdates.push({
      id: line.id,
      data: {
        qty_ordered: edit.qty, line_status: 'received', batch_number: item.batch_number,
        expiry_date: item.expiry_date, grn_id: ids.grnId, updatedAt: now
      }
    });
  }

  if (receivedItems.length === 0) throw new Error('At least one received product is required.');
  const supplierLine = lines.find(l => l.supplier_type !== 'internal_hq' && l.supplier_type !== 'internal_warehouse');
  const supplierId = supplierLine?.supplier_id || 'UNKNOWN';
  const supplierName = supplierLine?.supplier_name || 'Unknown Supplier';
  const externalSupplierIds = new Set(
    lines
      .filter(line => line.supplier_type !== 'internal_hq' && line.supplier_type !== 'internal_warehouse')
      .map(line => line.supplier_id || 'UNKNOWN')
  );
  if (externalSupplierIds.size > 1) {
    throw new Error('One GRN cannot combine invoices from multiple suppliers. Process each supplier separately.');
  }
  const branchId = order.requesting_branch_id || 'UNKNOWN';
  const branchName = order.requesting_branch_name || 'Branch';
  const isHqDestination = branchId === 'HQ';

  if (financeValue > 0 && supplierId === 'UNKNOWN') throw new Error('A supplier is required for externally purchased stock.');
  if (paymentType === 'cash' && financeValue > 0) {
    const ledger = await getDocs(query(collection(db, 'petty_cash_ledger'), where('tenantId', '==', tenantId)));
    const available = ledger.docs.reduce((sum, snap) => {
      const data = snap.data();
      return sum + (data.type === 'incoming' ? Number(data.amount || 0) : -Number(data.amount || 0));
    }, 0);
    if (available < financeValue) {
      throw new Error(`Insufficient Management Petty Cash. Available: UGX ${available.toLocaleString()}, required: UGX ${financeValue.toLocaleString()}.`);
    }
  }

  const result = await runTransaction(db, async transaction => {
    const refs = {
      grn: doc(db, 'grn_records', ids.grnId),
      invoice: doc(db, 'invoices', ids.invoiceId),
      procurementInvoice: doc(db, 'procurement_invoices', ids.procurementInvoiceId),
      credit: doc(db, 'creditLedger', ids.creditId),
      pettyCash: doc(db, 'petty_cash_ledger', ids.pettyCashId),
      transfer: doc(db, 'transfer_invoices', ids.transferId),
      audit: doc(db, 'financial_posting_audit', ids.auditId),
      order: doc(db, 'stock_orders', order.id)
    };
    const lineRefs = lineUpdates.map(line => doc(db, 'stock_order_lines', line.id));
    const reads = await Promise.all([
      transaction.get(refs.grn), transaction.get(refs.invoice), transaction.get(refs.credit),
      transaction.get(refs.pettyCash), transaction.get(refs.transfer), transaction.get(refs.order),
      ...lineRefs.map(ref => transaction.get(ref))
    ]);
    const existingGrn = reads[0];
    if (existingGrn.exists() && existingGrn.data().financial_posting_status === 'posted') {
      return { alreadyProcessed: true };
    }
    const existingInvoice = reads[1].exists() ? reads[1].data() : null;
    const existingCredit = reads[2].exists() ? reads[2].data() : null;
    if (existingInvoice && existingInvoice.tenantId !== tenantId) throw new Error('Invoice ID collision across tenants.');
    if (existingCredit && existingCredit.tenantId !== tenantId) throw new Error('Credit ID collision across tenants.');

    const invoiceRefValue = input.invoiceNumber.trim();
    const invoiceData = {
      tenantId, invoiceId: ids.invoiceId, invoiceRef: invoiceRefValue,
      supplierInvoiceNumber: invoiceRefValue, grnId: ids.grnId, grnRef: grnNumber,
      branchId, branchName, supplierId, supplierName, invoiceValue: financeValue,
      paymentType,
      paymentStatus: existingInvoice?.paymentStatus || paymentType,
      creditBalance: existingInvoice?.creditBalance ?? (paymentType === 'credit' ? financeValue : 0),
      invoiceDate: invoiceTimestamp, dueDate, createdAt: existingInvoice?.createdAt || now, updatedAt: now,
      type: 'payable', items: financeItems,
      // Read compatibility for older Procurement views.
      branch_id: branchId, branch_name: branchName, supplier_id: supplierId, supplier_name: supplierName,
      invoice_number: invoiceRefValue, grn_number: grnNumber, amount: financeValue,
      status: paymentType === 'cash' ? 'Paid' : 'Unpaid', created_at: now.toDate().toISOString()
    };

    transaction.set(refs.grn, {
      tenantId, id: ids.grnId, grn_number: grnNumber, order_id: order.id,
      invoice_id: financeValue > 0 ? ids.invoiceId : null,
      procurement_invoice_id: financeValue > 0 ? ids.procurementInvoiceId : null,
      credit_ledger_id: paymentType === 'credit' && financeValue > 0 ? ids.creditId : null,
      transfer_id: receivedItems.length ? ids.transferId : null,
      supplier_id: supplierId, supplier_name: supplierName,
      destination_branch_id: branchId, destination_branch_name: branchName,
      invoice_number: invoiceRefValue, invoice_date: input.invoiceDate,
      receivedAt: now, receivedBy: user.uid, status: 'completed',
      grn_status: 'completed', dispatch_status: 'dispatched', reception_status: 'awaiting_receipt',
      financial_posting_status: financeValue > 0 ? 'posted' : 'not_applicable',
      payment_type: paymentType, payment_status: paymentType === 'cash' ? 'paid' : 'outstanding',
      total_value_ugx: financeValue, transfer_value_ugx: transferValue,
      inputVat: input.inputVat, whtAmount: input.whtAmount, items: receivedItems,
      notes: input.notes, createdAt: now, updatedAt: now
    }, { merge: true });

    if (financeValue > 0) {
      transaction.set(refs.invoice, invoiceData, { merge: true });
      transaction.set(refs.procurementInvoice, {
        ...invoiceData, amount: financeValue, total_amount_ugx: financeValue,
        paid_amount_ugx: paymentType === 'cash' ? financeValue : 0
      }, { merge: true });
      if (paymentType === 'credit') {
        const existingRemaining = existingCredit
          ? Number(existingCredit.remainingCreditBalance ?? existingCredit.balance ?? financeValue)
          : financeValue;
        transaction.set(refs.credit, {
          tenantId, invoiceId: ids.invoiceId, invoiceRef: invoiceRefValue,
          grnId: ids.grnId, grnRef: grnNumber, supplierId, supplierName, branchId, branchName,
          originalCreditAmount: financeValue, remainingCreditBalance: existingRemaining,
          status: existingRemaining === 0 ? 'paid' : existingRemaining < financeValue ? 'partial' : 'outstanding',
          creditAccruedAt: existingCredit?.creditAccruedAt || invoiceTimestamp, dueDate,
          paymentHistoryIds: existingCredit?.paymentHistoryIds || [],
          createdAt: existingCredit?.createdAt || now, updatedAt: now,
          lastProcessedAt: existingCredit?.lastProcessedAt || null,
          // Legacy aliases retained until all historical readers are migrated.
          invoiceNumber: invoiceRefValue, amount: financeValue, balance: existingRemaining
        }, { merge: true });
      } else {
        transaction.set(refs.pettyCash, {
          tenantId, date: input.invoiceDate, amount: financeValue, source: 'Procurement cash GRN',
          reference_number: invoiceRefValue, type: 'outgoing', branch_id: branchId,
          grnId: ids.grnId, invoiceId: ids.invoiceId, logged_by: user.uid,
          notes: `Cash stock purchase - GRN ${grnNumber} - Supplier: ${supplierName}`,
          createdAt: now, created_at: now.toDate().toISOString()
        }, { merge: true });
      }
    }

    unsupplied.forEach(item => transaction.set(doc(db, 'unsupplied_lines', item.id), item.data, { merge: true }));
    lineUpdates.forEach((line, index) => transaction.update(lineRefs[index], line.data));
    transaction.update(refs.order, {
      status: 'dispatched', grn_id: ids.grnId, transfer_id: ids.transferId,
      financial_posting_status: financeValue > 0 ? 'posted' : 'not_applicable', updatedAt: now
    });

    if (receivedItems.length) {
      transaction.set(refs.transfer, {
        tenantId, transfer_number: `TI-${grnNumber}`, order_id: order.id, grn_id: ids.grnId,
        invoice_id: financeValue > 0 ? ids.invoiceId : null, invoice_ref: invoiceRefValue,
        source_branch_id: isHqDestination ? 'PROCUREMENT' : 'HQ',
        source_branch_name: isHqDestination ? supplierName : 'Central HQ',
        destination_branch_id: branchId, destination_branch_name: branchName,
        transfer_type: isHqDestination ? 'procurement_grn' : 'central_to_branch', status: 'dispatched', dispatched_at: now.toDate().toISOString(),
        dispatchedAt: now, dispatched_by: user.uid, dispatched_by_name: user.name,
        total_items: receivedItems.length, total_value_ugx: transferValue, createdAt: now, updatedAt: now
      }, { merge: true });
      receivedItems.forEach(item => {
        const lineId = `${ids.transferId}_${stablePart(item.line_id)}`;
        transaction.set(doc(db, 'transfer_invoice_lines', lineId), {
          tenantId, transfer_id: ids.transferId, grn_id: ids.grnId, invoice_id: ids.invoiceId,
          source_line_id: item.line_id, product_id: item.product_id, product_name: item.product_name,
          qty_dispatched: item.qty_received, unit_cost_ugx: item.unit_cost_ugx,
          total_cost_ugx: item.total_cost_ugx, batch_number: item.batch_number,
          expiry_date: item.expiry_date, line_status: 'dispatched', createdAt: now, updatedAt: now
        }, { merge: true });
      });
    }

    transaction.set(refs.audit, {
      tenantId, action: 'procurement_financial_posting', grnId: ids.grnId,
      invoiceId: financeValue > 0 ? ids.invoiceId : null,
      creditLedgerId: paymentType === 'credit' && financeValue > 0 ? ids.creditId : null,
      branchId, processedBy: user.uid, paymentType, amount: financeValue,
      financialPostingTimestamp: now, reconciliation: false
    }, { merge: true });
    return { alreadyProcessed: false };
  });

  return {
    grnId: ids.grnId, grnNumber,
    invoiceId: financeValue > 0 ? ids.invoiceId : null,
    creditId: paymentType === 'credit' && financeValue > 0 ? ids.creditId : null,
    transferId: receivedItems.length ? ids.transferId : null,
    alreadyProcessed: result.alreadyProcessed
  };
}
