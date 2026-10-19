import { validateOperationalDeliveryRoute, type OperationalDeliveryRoute } from './operationalDeliveryRoute';
import { operationalReceiptCostPerPack } from './operationalValuationPolicy';
import type { Firestore } from 'firebase/firestore';
import { doc, runTransaction, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { OperationalInventory, OperationalInventoryMaster, StockOrder, StockOrderLine } from '../types';
import { GrnLineEdit } from './procurementFinanceService';
import { planOperationalGrnFinanceEvents } from './operationalGrnFinancePolicy';
import { planCentralGrnFinance, type SupplierPaymentTerms } from './centralGrnFinanceContract';

export interface ProcessOperationalGrnInput {
  deliveryRoute?: OperationalDeliveryRoute;
  tenantId: string;
  order: StockOrder;
  lines: StockOrderLine[];
  editedLines: Record<string, GrnLineEdit & { unitCostUGX?: number }>;
  invoiceNumber: string;
  invoiceDate: string;
  paymentType: SupplierPaymentTerms;
  inputVat: number;
  whtAmount: number;
  notes: string;
  user: { uid: string; name: string };
}

export interface ProcessOperationalGrnResult {
  grnId: string;
  grnNumber: string;
  alreadyProcessed: boolean;
  receivedValueUGX: number;
}

const hash = (value: string) => {
  let code = 2166136261;
  for (let index = 0; index < value.length; index++) {
    code ^= value.charCodeAt(index);
    code = Math.imul(code, 16777619);
  }
  return (code >>> 0).toString(36).toUpperCase();
};

function validInvoiceDate(value: string): Timestamp {
  const date = new Date(`${value}T12:00:00`);
  if (!value || Number.isNaN(date.getTime())) throw new Error('A valid supplier invoice date is required.');
  return Timestamp.fromDate(date);
}

/** Posts supplier evidence atomically, crediting HQ stock only for the VIA_HQ route. */
export async function processOperationalGrn(input: ProcessOperationalGrnInput, connection: Firestore = db): Promise<ProcessOperationalGrnResult> {
  const tenantId = input.tenantId.trim();
  const deliveryRoute = input.deliveryRoute || 'VIA_HQ';
  validateOperationalDeliveryRoute(deliveryRoute, input.order.requesting_branch_id);
  const direct = deliveryRoute === 'DIRECT_BRANCH';
  const locationId = direct ? 'SUPPLIER_TRANSIT' : 'HQ_OPERATIONAL';
  const invoiceNumber = input.invoiceNumber.trim();
  const invoiceTimestamp = validInvoiceDate(input.invoiceDate);
  if (!['cash', 'credit'].includes(input.paymentType)) throw new Error('Choose Cash or Credit at Central Operational GRN.');
  if (!tenantId || !input.order?.id || !invoiceNumber || !input.user.uid) {
    throw new Error('Tenant, Operational order, supplier invoice and receiving user are required.');
  }
  if (input.order.tenantId !== tenantId || !(input.order.inventoryClass === 'OPERATIONAL' || input.order.category === 'non_sellable')) {
    throw new Error('This processor accepts Operational Inventory orders only.');
  }
  if (!Number.isFinite(input.inputVat) || input.inputVat < 0 || !Number.isFinite(input.whtAmount) || input.whtAmount < 0) {
    throw new Error('VAT and withholding values must be zero or greater.');
  }

  const supplierLines = input.lines.filter(line => line.supplier_type === 'external');
  if (supplierLines.length === 0) throw new Error('This Operational GRN has no externally sourced lines.');
  if (supplierLines.length > 150) throw new Error('Process no more than 150 Operational GRN lines at a time.');
  if (supplierLines.some(line => line.inventoryClass !== 'OPERATIONAL' && !line.isOperational)) {
    throw new Error('A Sellable line cannot be received on an Operational GRN.');
  }
  const suppliers = new Set(supplierLines.map(line => line.supplier_id || ''));
  if (suppliers.size !== 1 || suppliers.has('')) throw new Error('One Operational GRN must contain lines from one identified supplier.');

  const supplierId = supplierLines[0].supplier_id!;
  const supplierName = supplierLines[0].supplier_name || 'Supplier';
  const receivedInput = supplierLines.map(line => {
    const edit = input.editedLines[line.id];
    if (!edit) throw new Error(`Enter the received quantity for ${line.product_name || line.product_id}.`);
    const outstanding = Math.max(0, Number(line.qty_ordered || 0) - Number(line.qty_received || 0));
    const quantity = edit.removed ? 0 : Number(edit.qty);
    const cost = Number(edit.unitCostUGX ?? line.unit_cost_ugx ?? 0);
    if (!Number.isFinite(quantity) || quantity < 0 || quantity > outstanding) {
      throw new Error(`Received quantity exceeds the outstanding quantity for ${line.product_name || line.product_id}.`);
    }
    if (!Number.isFinite(cost) || cost < 0) throw new Error(`Unit cost is invalid for ${line.product_name || line.product_id}.`);
    if (quantity > 0 && !line.masterItemId) throw new Error(`Link ${line.product_name || line.product_id} to a tenant Operational identity before receiving it.`);
    return { line, edit, quantity, cost, outstanding };
  });
  const receivingLines = receivedInput.filter(row => row.quantity > 0);
  if (receivingLines.length === 0) throw new Error('At least one Operational item must be received.');
  if (new Set(receivingLines.map(row => row.line.masterItemId)).size !== receivingLines.length) {
    throw new Error('An Operational item may appear only once on a single GRN.');
  }

  const fingerprint = hash(JSON.stringify({
    orderId: input.order.id,
    supplierId,
    invoiceNumber,
    invoiceDate: input.invoiceDate,
    paymentType: input.paymentType,
    deliveryRoute,
    items: receivedInput.map(row => ({ lineId: row.line.id, qty: row.quantity, unitCost: row.cost })).sort((a, b) => a.lineId.localeCompare(b.lineId))
  }));
  const grnId = `op_grn_${hash(`${tenantId}|${input.order.id}|${supplierId}|${invoiceNumber.toLowerCase()}`)}`;
  const grnNumber = `OGRN-${input.invoiceDate.slice(0, 4)}-${hash(grnId)}`;
  const now = Timestamp.now();
  const orderRef = doc(connection, 'stock_orders', input.order.id);
  const orderLines = supplierLines;
  const lineRefs = orderLines.map(line => doc(connection, 'stock_order_lines', line.id));
  const sourceItemRefs = receivingLines.map(row => doc(connection, 'operational_inventory', row.line.product_id));
  const masterRefs = receivingLines.map(row => doc(connection, 'operational_inventory_masters', row.line.masterItemId!));
  const grnRef = doc(connection, 'grn_records', grnId);
  const settingsRef = doc(connection, 'system_settings', tenantId);
  const movementKeys = receivingLines.map(row => `grn_${hash(`${grnId}|${row.line.id}`)}`);
  const movementRefs = movementKeys.map(key => doc(connection, 'operational_inventory_movements', `opm_${key}`));
  const grnLineRefs = receivingLines.map(row => doc(connection, 'operational_grn_lines', `${grnId}_${hash(row.line.id)}`));
  const financeEventIds = ['CONSUMABLE_OPERATIONAL', 'FIXED_ASSET'].map(type => `opfin_${hash(`${grnId}|${type}`)}`);
  const financeEventRefs = financeEventIds.map(id => doc(connection, 'operational_finance_events', id));
  const financeInvoiceId = `procurement_invoice_${grnId}`;
  const invoiceRef = doc(connection, 'invoices', financeInvoiceId);
  const registerRef = doc(connection, 'procurement_invoices', `procurement_register_${grnId}`);
  const creditRef = doc(connection, 'creditLedger', `supplier_credit_${grnId}`);
  const cashDraftRef = doc(connection, 'management_expenses', `management_payment_draft_${grnId}`);

  return runTransaction(connection, async transaction => {
    const [settingsSnapshot, orderSnapshot, grnSnapshot, lineSnapshots, sourceSnapshots, masterSnapshots, movementSnapshots, grnLineSnapshots, financeEventSnapshots, invoiceSnap, registerSnap, creditSnap, cashDraftSnap] = await Promise.all([
      transaction.get(settingsRef),
      transaction.get(orderRef),
      transaction.get(grnRef),
      Promise.all(lineRefs.map(ref => transaction.get(ref))),
      Promise.all(sourceItemRefs.map(ref => transaction.get(ref))),
      Promise.all(masterRefs.map(ref => transaction.get(ref))),
      Promise.all(movementRefs.map(ref => transaction.get(ref))),
      Promise.all(grnLineRefs.map(ref => transaction.get(ref))),
      Promise.all(financeEventRefs.map(ref => transaction.get(ref))),
      transaction.get(invoiceRef), transaction.get(registerRef), transaction.get(creditRef), transaction.get(cashDraftRef)
    ]);

    const settings = settingsSnapshot.data();
    if (!settingsSnapshot.exists() || settings?.tenantId !== tenantId || settings.featureToggles?.enableOperationalInventory !== true) {
      throw new Error('Operational Inventory is disabled in System Settings.');
    }
    if (!orderSnapshot.exists() || orderSnapshot.data().tenantId !== tenantId ||
        !(orderSnapshot.data().inventoryClass === 'OPERATIONAL' || orderSnapshot.data().category === 'non_sellable')) {
      throw new Error('The source order is missing, belongs to another tenant, or is not Operational.');
    }
    if (grnSnapshot.exists()) {
      const existing = grnSnapshot.data();
      if (existing.tenantId !== tenantId || existing.order_id !== input.order.id || existing.idempotencyFingerprint !== fingerprint) {
        throw new Error('This supplier invoice reference has already been used for a different Operational GRN.');
      }
      return { grnId, grnNumber: existing.grn_number, alreadyProcessed: true, receivedValueUGX: Number(existing.total_value_ugx || 0) };
    }
    const lockedRoute = orderSnapshot.data().operational_delivery_route;
    const hasHistoricalReceipts = lineSnapshots.some(snapshot => Number(snapshot.data()?.qty_received || 0) > 0);
    if ((lockedRoute && lockedRoute !== deliveryRoute) || (!lockedRoute && hasHistoricalReceipts && direct)) {
      throw new Error('This order already has a posted GRN. Its delivery route cannot change.');
    }
    if (!['approved', 'fully_received'].includes(orderSnapshot.data().status)) {
      throw new Error('The Operational order must be approved before receiving a supplier delivery.');
    }
    if (invoiceSnap.exists() || registerSnap.exists() || creditSnap.exists() || cashDraftSnap.exists()) {
      throw new Error('Operational supplier invoice posting already exists without matching GRN. Reconcile before retry.');
    }
    if (movementSnapshots.some(snapshot => snapshot.exists()) || grnLineSnapshots.some(snapshot => snapshot.exists())) {
      throw new Error('An Operational GRN movement already exists without its parent GRN. Reconcile before retrying.');
    }

    const hqItemRefs = masterSnapshots.map((snapshot, index) => {
      if (!snapshot.exists()) throw new Error('An Operational tenant item identity is missing.');
      const master = snapshot.data() as OperationalInventoryMaster;
      if (master.tenantId !== tenantId || master.inventoryClass !== 'OPERATIONAL' || (!direct && !master.hqLocationItemId)) {
        throw new Error('Register this Operational item at HQ before receiving a supplier delivery.');
      }
      return direct ? sourceItemRefs[index] : doc(connection, 'operational_inventory', master.hqLocationItemId);
    });
    const hqSnapshots = await Promise.all(hqItemRefs.map(ref => transaction.get(ref)));

    const receivedLines: any[] = [];
    const movementDocs: any[] = [];
    let totalValueUGX = 0;
    let allSupplierLinesComplete = true;

    for (let index = 0; index < receivedInput.length; index++) {
      const inputRow = receivedInput[index];
      const orderLineSnapshot = lineSnapshots[supplierLines.findIndex(line => line.id === inputRow.line.id)];
      if (!orderLineSnapshot.exists()) throw new Error(`Order line ${inputRow.line.product_name || inputRow.line.id} no longer exists.`);
      const orderLine = orderLineSnapshot.data();
      if (orderLine.tenantId !== tenantId || orderLine.order_id !== input.order.id || orderLine.inventoryClass !== 'OPERATIONAL' ||
          orderLine.supplier_type !== 'external' || orderLine.supplier_id !== supplierId || orderLine.line_status !== 'approved') {
        throw new Error('A source order line does not belong to this Operational order.');
      }
      if (inputRow.quantity === 0) {
        if (inputRow.edit.removed) {
          transaction.update(lineRefs[supplierLines.findIndex(line => line.id === inputRow.line.id)], {
            line_status: 'unsupplied', qty_unsupplied: inputRow.outstanding,
            unsupplied_reason: 'Removed during Operational GRN processing', grn_id: grnId, updatedAt: now.toDate().toISOString()
          });
          const unsuppliedRef = doc(connection, 'unsupplied_lines', `${grnId}_${hash(inputRow.line.id)}`);
          transaction.set(unsuppliedRef, {
            tenantId, inventoryClass: 'OPERATIONAL', order_id: input.order.id, grn_id: grnId,
            original_line_id: inputRow.line.id, product_id: inputRow.line.product_id,
            product_name: inputRow.line.product_name, qty_unsupplied: inputRow.outstanding,
            reason: 'Removed during Operational GRN processing', status: 'pending', createdAt: now
          });
        } else {
          allSupplierLinesComplete = false;
        }
        continue;
      }
      const sourceSnapshotIndex = receivingLines.findIndex(row => row.line.id === inputRow.line.id);
      if (sourceSnapshotIndex < 0) continue;
      const sourceSnapshot = sourceSnapshots[sourceSnapshotIndex];
      const masterSnapshot = masterSnapshots[sourceSnapshotIndex];
      const hqSnapshot = hqSnapshots[sourceSnapshotIndex];
      const source = sourceSnapshot.exists() ? { ...sourceSnapshot.data(), id: sourceSnapshot.id } as OperationalInventory : undefined;
      const master = { ...masterSnapshot.data(), id: masterSnapshot.id } as OperationalInventoryMaster;
      const hqItem = hqSnapshot.exists() ? { ...hqSnapshot.data(), id: hqSnapshot.id } as OperationalInventory : undefined;
      if (!sourceSnapshot.exists() || !hqSnapshot.exists() || source?.tenantId !== tenantId || source.inventoryClass !== 'OPERATIONAL' ||
          source.branchId !== input.order.requesting_branch_id || source.masterItemId !== inputRow.line.masterItemId ||
          master.tenantId !== tenantId || master.inventoryClass !== 'OPERATIONAL' || master.operationalType !== source.operationalType ||
          hqItem?.tenantId !== tenantId || hqItem.branchId !== (direct ? input.order.requesting_branch_id : 'HQ') || hqItem.inventoryClass !== 'OPERATIONAL' ||
          hqItem.operationalType !== master.operationalType || hqItem.masterItemId !== master.id) {
        throw new Error(`Operational identity or HQ location mismatch for ${inputRow.line.product_name || inputRow.line.product_id}.`);
      }

      const unitsPerPack = Math.max(1, Number(master.unitPerPack || hqItem.unitPerPack || 1));
      if (Number(hqItem.unitPerPack || 1) !== unitsPerPack) throw new Error('The HQ and branch issue units do not match.');
      const receivedUnits = inputRow.quantity * unitsPerPack;
      const balanceBefore = Number(hqItem.quantityInStock || 0);
      const balanceAfter = balanceBefore + receivedUnits;
      if (!Number.isFinite(balanceBefore) || balanceBefore < 0 || !Number.isFinite(balanceAfter)) throw new Error('HQ Operational balance is invalid.');
      const lineValue = inputRow.quantity * inputRow.cost;
      const unitCostIssueUGX = inputRow.cost / unitsPerPack;
      const movementKey = movementKeys[sourceSnapshotIndex];
      const movementId = direct ? '' : movementRefs[sourceSnapshotIndex].id;
      const operationalType = master.operationalType;

      receivedLines.push({
        inventoryClass: 'OPERATIONAL', operationalType, masterItemId: master.id,
        product_id: hqItem.id, source_product_id: source.id, product_name: master.name,
        qty_ordered: inputRow.outstanding, qty_received: inputRow.quantity, qty_received_units: receivedUnits,
        unit_cost_ugx: inputRow.cost, unit_cost_issue_ugx: unitCostIssueUGX, total_cost_ugx: lineValue,
        status: 'received', source_order_line_id: inputRow.line.id, supplier_id: supplierId, supplier_name: supplierName
      });
      totalValueUGX += lineValue;
      if (inputRow.quantity < inputRow.outstanding) allSupplierLinesComplete = false;

      movementDocs.push({
        tenantId, inventoryClass: 'OPERATIONAL', itemId: hqItem.id, masterItemId: master.id, itemName: master.name,
        locationId: 'HQ_OPERATIONAL', branchId: 'HQ', movementType: 'RECEIPT', quantityDelta: receivedUnits,
        balanceBefore, balanceAfter, unitCostUGX: unitCostIssueUGX, totalValueUGX: lineValue,
        reference: grnNumber, idempotencyKey: movementKey, actorId: input.user.uid, actorName: input.user.name,
        sourceTransactionId: grnId, createdAt: now
      });

      if (!direct) {
      transaction.update(hqItemRefs[sourceSnapshotIndex], {
        inventoryClass: 'OPERATIONAL', operationalType, quantityInStock: balanceAfter,
        costPerPack: operationalReceiptCostPerPack(balanceBefore, receivedUnits, Number(hqItem.costPerPack || 0), unitCostIssueUGX, unitsPerPack),
        lastMovementId: movementId, updatedAt: now.toDate().toISOString()
      });
      transaction.set(movementRefs[sourceSnapshotIndex], movementDocs[movementDocs.length - 1]);
      }
      transaction.set(grnLineRefs[sourceSnapshotIndex], {
        tenantId, inventoryClass: 'OPERATIONAL', operationalType, grnId, orderId: input.order.id,
        orderLineId: inputRow.line.id, itemId: hqItem.id, masterItemId: master.id,
        movementId,
        itemName: master.name, supplierId, supplierName, qtyOrdered: inputRow.outstanding,
        qtyReceived: inputRow.quantity, qtyReceivedUnits: receivedUnits,
        unitCostUGX: inputRow.cost, unitCostIssueUGX, totalValueUGX: lineValue,
        locationId, deliveryRoute, receivedBy: input.user.uid, createdAt: now
      });

      const cumulativeReceived = Number(orderLine.qty_received || 0) + inputRow.quantity;
      const remainingAfterReceipt = Math.max(0, Number(orderLine.qty_ordered || 0) - cumulativeReceived);
      transaction.update(lineRefs[supplierLines.findIndex(line => line.id === inputRow.line.id)], {
        qty_received: cumulativeReceived,
        qty_received_units: Number(orderLine.qty_received_units || 0) + receivedUnits,
        unit_cost_ugx: inputRow.cost,
        line_status: remainingAfterReceipt === 0 ? 'received' : 'approved',
        grn_id: grnId,
        operational_delivery_route: deliveryRoute,
        grn_ids: [...new Set([...(Array.isArray(orderLine.grn_ids) ? orderLine.grn_ids : []), grnId])],
        updatedAt: now.toDate().toISOString()
      });
      if (remainingAfterReceipt > 0) allSupplierLinesComplete = false;
    }

    if (receivedLines.length === 0) throw new Error('At least one Operational line must be received.');
    const financePlan = planCentralGrnFinance({
      tenantId, orderId: input.order.id, grnId, invoiceRef: invoiceNumber,
      supplierId, inventoryClass: 'OPERATIONAL', paymentType: input.paymentType,
      lines: receivedLines.map(line => ({
        orderLineId: line.source_order_line_id, supplierId,
        quantity: line.qty_received, unitCostUGX: line.unit_cost_ugx,
        operationalType: line.operationalType
      }))
    });
    if (financePlan.invoiceAmountUGX !== totalValueUGX) {
      throw new Error('Operational GRN invoice total is inconsistent with received quantities.');
    }
    const invoiceData = {
      tenantId, inventoryClass: 'OPERATIONAL', invoiceId: financeInvoiceId,
      grnId, grnRef: grnNumber, invoiceRef: invoiceNumber,
      supplierInvoiceNumber: invoiceNumber, invoiceDate: invoiceTimestamp,
      supplierId, supplierName, branchId: input.order.requesting_branch_id,
      branchName: input.order.requesting_branch_name || 'Requesting Branch',
      invoiceValue: totalValueUGX, paymentType: input.paymentType,
      paymentStatus: financePlan.paymentStatus, paidAmountUGX: 0,
      creditBalance: totalValueUGX, status: 'Unpaid',
      amount: totalValueUGX, total_amount_ugx: totalValueUGX,
      paid_amount_ugx: 0, branch_id: input.order.requesting_branch_id,
      supplier_id: supplierId, supplier_name: supplierName,
      invoice_number: invoiceNumber, grn_number: grnNumber,
      invoice_date: input.invoiceDate, created_at: now.toDate().toISOString(),
      items: receivedLines, type: 'payable',
      accountingClassification: financePlan.expenseRecognition,
      createdAt: now, updatedAt: now
    };
    transaction.set(invoiceRef, invoiceData);
    transaction.set(registerRef, invoiceData);
    if (input.paymentType === 'credit') {
      transaction.set(creditRef, {
        tenantId, inventoryClass: 'OPERATIONAL', invoiceId: financeInvoiceId,
        invoiceRef: invoiceNumber, grnId, grnRef: grnNumber,
        supplierId, supplierName, branchId: input.order.requesting_branch_id,
        branchName: input.order.requesting_branch_name || 'Requesting Branch',
        originalCreditAmount: totalValueUGX, remainingCreditBalance: totalValueUGX,
        balance: totalValueUGX, amount: totalValueUGX,
        status: 'outstanding', creditAccruedAt: invoiceTimestamp,
        createdAt: now, updatedAt: now, paymentHistoryIds: []
      });
    } else {
      transaction.set(cashDraftRef, {
        tenantId, source: 'procurement_cash_grn', sourceType: 'procurement',
        sourceRef: grnId, sourceRefId: grnId, grnId,
        invoiceId: financeInvoiceId, invoiceRef: invoiceNumber,
        supplierId, supplierName, branchId: input.order.requesting_branch_id,
        branch_id: input.order.requesting_branch_id,
        inventoryClass: 'OPERATIONAL', category: 'Procurement Cash Invoice',
        department: 'HQ',
        description: `Operational supplier invoice awaiting Finance settlement: ${invoiceNumber}`,
        amount: totalValueUGX, amount_ugx: totalValueUGX, originalAmount: totalValueUGX,
        expense_date: input.invoiceDate, payment_method: 'Management Petty Cash',
        status: 'draft', paymentStatus: 'pending_payment',
        excludeFromOpexRollup: true, accountingRecognitionSource: 'OPERATIONAL_GRN',
        createdBy: input.user.uid, logged_by: input.user.name,
        createdAt: now, created_at: now.toDate().toISOString()
      });
    }
    const operationalTypes = new Set(receivedLines.map(line => line.operationalType));
    transaction.set(grnRef, {
      tenantId, id: grnId, inventoryClass: 'OPERATIONAL',
      ...(operationalTypes.size === 1 ? { operationalType: Array.from(operationalTypes)[0] } : {}),
      grn_number: grnNumber, order_id: input.order.id, procurement_requisition_id: input.order.id,
      supplier_id: supplierId, supplier_name: supplierName, invoice_number: invoiceNumber,
      invoice_date: input.invoiceDate, receivedAt: now.toDate().toISOString(), receivedBy: input.user.uid,
      deliveryRoute, destination_branch_id: direct ? input.order.requesting_branch_id : 'HQ', destination_store_id: locationId, status: 'completed',
      grn_status: 'completed', financial_posting_status: 'event_created', invoice_posting_status: 'posted',
      invoice_id: financeInvoiceId, procurement_invoice_id: registerRef.id,
      credit_ledger_id: input.paymentType === 'credit' ? creditRef.id : null,
      payment_type: input.paymentType,
      payment_status: input.paymentType === 'cash' ? 'pending_payment' : 'outstanding', total_value_ugx: totalValueUGX, transfer_value_ugx: 0,
      inputVat: input.inputVat, whtAmount: input.whtAmount, itemCount: receivedLines.length,
      notes: input.notes, idempotencyFingerprint: fingerprint, createdAt: now, updatedAt: now
    });

    const financeEvents = planOperationalGrnFinanceEvents(receivedLines.map(line => ({
      operationalType: line.operationalType, itemId: line.product_id, itemName: line.product_name,
      quantity: line.qty_received_units, totalValueUGX: line.total_cost_ugx
    })));
    for (const event of financeEvents) {
      const index = event.operationalType === 'FIXED_ASSET' ? 1 : 0;
      if (financeEventSnapshots[index].exists()) throw new Error('An Operational GRN finance event already exists without its parent GRN. Reconcile before retrying.');
      transaction.set(financeEventRefs[index], {
        tenantId, inventoryClass: 'OPERATIONAL', operationalType: event.operationalType,
        eventKind: event.eventKind, status: 'READY_FOR_FINANCE', eventId: financeEventIds[index],
        sourceType: 'OPERATIONAL_GRN', sourceId: grnId, sourceOrderId: input.order.id,
        supplierId, supplierName, invoiceNumber, invoiceDate: input.invoiceDate,
        amountUGX: event.amountUGX, currency: 'UGX', destinationStoreId: locationId,
        lines: event.lines, createdBy: input.user.uid, createdAt: now
      });
    }

    if (allSupplierLinesComplete) {
      transaction.update(orderRef, { status: 'fully_received', operational_delivery_route: deliveryRoute, last_grn_id: grnId, updatedAt: now.toDate().toISOString() });
    } else {
      transaction.update(orderRef, { status: 'approved', operational_delivery_route: deliveryRoute, last_grn_id: grnId, updatedAt: now.toDate().toISOString() });
    }

    return { grnId, grnNumber, alreadyProcessed: false, receivedValueUGX: totalValueUGX };
  });
}
