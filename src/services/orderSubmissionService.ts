import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where,
  runTransaction,
  Timestamp,
  updateDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import { 
  AutoGenerateOrderRun, 
  AutoGenerateOrderLine,
  InventoryTransferReservation,
  OperationalInventory,
  Product,
  ProductBatch
} from '../types';
import { calculateAggregateProductForecast, calculateProductForecast } from './forecastingService';

export interface RevalidationResult {
  hasChanges: boolean;
  warnings: {
    productId: string;
    productName: string;
    type: 'STOCK_DROP' | 'COMMITMENT_CHANGE' | 'PRICE_CHANGE' | 'BUDGET_EXCEEDED';
    message: string;
    details: any;
  }[];
}

export const getHqAutoOrderId = (runId: string, groupKey: string) =>
  `auto_order_${`${runId}_${groupKey}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180)}`;

async function requireOperationalInventoryEnabled(tenantId: string): Promise<void> {
  const settings = await getDoc(doc(db, 'system_settings', tenantId));
  if (!settings.exists() || settings.data().tenantId !== tenantId ||
      settings.data().featureToggles?.enableOperationalInventory !== true) {
    throw new Error('Operational Inventory is disabled in System Settings.');
  }
}

function isOperationalAutoLine(line: AutoGenerateOrderLine): boolean {
  return line.inventoryClass === 'OPERATIONAL' || line.isOperational === true;
}

/**
 * Perform live pre-submission revalidation for an order run.
 */
export async function revalidateOrderRun(runId: string): Promise<RevalidationResult> {
  const result: RevalidationResult = {
    hasChanges: false,
    warnings: []
  };

  try {
    // 1. Fetch Run Snapshot
    const runSnap = await getDoc(doc(db, 'autoGenerateOrderRuns', runId));
    if (!runSnap.exists()) {
      throw new Error(`Run snapshot not found for ID: ${runId}`);
    }
    const run = runSnap.data() as AutoGenerateOrderRun;
    const tenantId = run.tenantId;
    const branchId = run.branchId;

    // 2. Fetch Run Lines
    const linesQuery = query(
      collection(db, 'autoGenerateOrderLines'),
      where('tenantId', '==', tenantId),
      where('runId', '==', runId)
    );
    const linesSnap = await getDocs(linesQuery);
    const lines = linesSnap.docs.map(d => ({ id: d.id, ...d.data() } as AutoGenerateOrderLine & { id: string }));
    if (lines.some(isOperationalAutoLine)) {
      await requireOperationalInventoryEnabled(tenantId);
    }

    let totalBudgetCost = 0;

    for (const line of lines) {
      if (isOperationalAutoLine(line)) {
        const operationalSnap = await getDoc(doc(db, 'operational_inventory', line.productId));
        if (!operationalSnap.exists()) {
          result.hasChanges = true;
          result.warnings.push({
            productId: line.productId,
            productName: line.productName,
            type: 'STOCK_DROP',
            message: 'This operational inventory item no longer exists and must be removed from the order.',
            details: {}
          });
          continue;
        }
        const operationalItem = operationalSnap.data() as OperationalInventory;
        if (!operationalItem.masterItemId) {
          result.hasChanges = true;
          result.warnings.push({
            productId: line.productId,
            productName: line.productName,
            type: 'STOCK_DROP',
            message: 'This legacy Operational item has not been linked to a tenant-wide item identity. Edit it in Inventory before ordering.',
            details: { identityMissing: true }
          });
          continue;
        }
        if (Number(operationalItem.costPerPack || 0) !== Number(line.calculationInputs?.costPricePerPack || 0)) {
          result.hasChanges = true;
          result.warnings.push({
            productId: line.productId,
            productName: line.productName,
            type: 'PRICE_CHANGE',
            message: `Operational item price changed from UGX ${line.calculationInputs?.costPricePerPack || 0} to UGX ${operationalItem.costPerPack || 0}.`,
            details: { previous: line.calculationInputs?.costPricePerPack || 0, current: operationalItem.costPerPack || 0 }
          });
        }
        totalBudgetCost += line.finalPurchasePacks * Number(operationalItem.costPerPack || 0);
        continue;
      }
      // Fetch product detail live
      const prodSnap = await getDoc(doc(db, 'products', line.productId));
      if (!prodSnap.exists()) {
        result.hasChanges = true;
        result.warnings.push({ productId: line.productId, productName: line.productName, type: 'STOCK_DROP', message: 'This product no longer exists and must be removed from the order before submission.', details: {} });
        continue;
      }
      const product = prodSnap.data() as Product;

      // Revalidate stockout / usable stock
      let forecast;
      if (run.configuration.demandScope === 'all_branches') {
        const branchesSnap = await getDocs(query(collection(db, 'branches'), where('tenantId', '==', tenantId)));
        forecast = await calculateAggregateProductForecast({
          tenantId,
          branchIds: branchesSnap.docs.map(snapshot => snapshot.id).filter(id => id !== branchId),
          inventoryBranchId: branchId,
          productId: line.productId,
          analysisStartDate: run.configuration.analysisStartDate,
          analysisEndDate: run.configuration.analysisEndDate,
          forecastCoverageDays: run.configuration.forecastCoverageDays,
          includeExceptionalConsumption: run.configuration.includeExceptionalConsumption,
          useSeasonality: run.configuration.applySeasonality
        }, product);
      } else {
        forecast = await calculateProductForecast({
          tenantId,
          branchId,
          productId: line.productId,
          analysisStartDate: run.configuration.analysisStartDate,
          analysisEndDate: run.configuration.analysisEndDate,
          forecastCoverageDays: run.configuration.forecastCoverageDays,
          includeExceptionalConsumption: run.configuration.includeExceptionalConsumption,
          useSeasonality: run.configuration.applySeasonality
        });
      }

      // Check if usable stock has dropped
      if (forecast.expiryAdjustedUsableStock < line.calculationOutputs?.expiryAdjustedUsableStock) {
        result.hasChanges = true;
        result.warnings.push({
          productId: line.productId,
          productName: line.productName,
          type: 'STOCK_DROP',
          message: `Usable stock at branch has dropped from ${line.calculationOutputs?.expiryAdjustedUsableStock} to ${forecast.expiryAdjustedUsableStock} base units.`,
          details: {
            previous: line.calculationOutputs?.expiryAdjustedUsableStock,
            current: forecast.expiryAdjustedUsableStock
          }
        });
      }

      // Check if price changed
      if (product.costPricePerPack !== line.calculationInputs?.costPricePerPack) {
        result.hasChanges = true;
        result.warnings.push({
          productId: line.productId,
          productName: line.productName,
          type: 'PRICE_CHANGE',
          message: `Supplier price changed from UGX ${line.calculationInputs?.costPricePerPack} to UGX ${product.costPricePerPack}.`,
          details: {
            previous: line.calculationInputs?.costPricePerPack,
            current: product.costPricePerPack
          }
        });
      }

      const cost = line.finalPurchasePacks * (product.costPricePerPack || 0);
      totalBudgetCost += cost;
    }

    // Check budget ceiling
    if (run.configuration.budgetCeiling && totalBudgetCost > run.configuration.budgetCeiling) {
      result.hasChanges = true;
      result.warnings.push({
        productId: 'BUDGET',
        productName: 'Total Run Budget',
        type: 'BUDGET_EXCEEDED',
        message: `Total cost of UGX ${totalBudgetCost.toLocaleString()} exceeds your ceiling of UGX ${run.configuration.budgetCeiling.toLocaleString()}.`,
        details: {
          ceiling: run.configuration.budgetCeiling,
          cost: totalBudgetCost
        }
      });
    }

  } catch (e: any) {
    console.error('Revalidation failed:', e);
    throw e;
  }

  return result;
}

/**
 * Atomically convert accepted calculations to PO drafts, transfer requests, and log audit entries.
 */

export async function submitOrderRun(runId: string, userId: string, userEmail: string, database = db): Promise<{
  orderIds: string[];
  transferIds: string[];
}> {
  const runRef = doc(database, 'autoGenerateOrderRuns', runId);
  const runSnap = await getDoc(runRef);
  if (!runSnap.exists()) throw new Error('Run snapshot does not exist');
  const run = runSnap.data() as AutoGenerateOrderRun;
  if (run.status === 'SUBMITTED') {
    return { orderIds: run.submittedOrderIds || [], transferIds: run.submittedTransferIds || [] };
  }
  if (run.status !== 'READY') throw new Error('The replenishment run is not ready for submission.');
  const tenantId = run.tenantId;
  const destinationBranchId = run.branchId;
  if (!tenantId || !destinationBranchId || !userId) throw new Error('Missing authenticated order submission context.');

  const linesSnap = await getDocs(query(collection(database, 'autoGenerateOrderLines'),
    where('tenantId', '==', tenantId), where('runId', '==', runId)));
  const lines = linesSnap.docs.map(snapshot => ({
    ...snapshot.data(), id: snapshot.id
  } as AutoGenerateOrderLine & { id: string }));
  if (lines.length === 0) throw new Error('Cannot submit an empty replenishment run.');
  if (lines.some(isOperationalAutoLine)) {
    await requireOperationalInventoryEnabled(tenantId);
    const unmapped = lines.find(line => isOperationalAutoLine(line) && !line.masterItemId);
    if (unmapped) throw new Error('Operational item ' + unmapped.productName + ' requires a tenant-wide identity.');
  }
  for (const line of lines) {
    if (!Number.isSafeInteger(line.finalPurchasePacks) || line.finalPurchasePacks < 0 ||
        !Number.isFinite(line.finalInternalAllocation) || line.finalInternalAllocation < 0) {
      throw new Error('Invalid replenishment quantities for ' + line.productName);
    }
    if (line.finalPurchasePacks > 0 && !(line.calculationInputs as any)?.supplierId) {
      throw new Error('Select a supplier for ' + line.productName + ' before submission.');
    }
  }

  type PlannedWrite = { ref: ReturnType<typeof doc>; data: Record<string, unknown> };
  const plannedOrders: PlannedWrite[] = [];
  const plannedOrderLines: PlannedWrite[] = [];
  const plannedTransfers: PlannedWrite[] = [];
  const plannedTransferLines: PlannedWrite[] = [];
  const reservationRefs: Array<ReturnType<typeof doc>> = [];
  const reservationSources = new Map<string, { donorId: string; inventoryClass: string }>();
  const orderIds: string[] = [];
  const transferIds: string[] = [];
  const timestamp = new Date().toISOString();
  const aggregate = run.configuration.demandScope === 'all_branches';
  const externalGroups = new Map<string, typeof lines>();
  const transferGroups = new Map<string, Array<{ line: typeof lines[number]; quantity: number }>>();

  for (const line of lines) {
    if (line.finalPurchasePacks > 0) {
      const group = (isOperationalAutoLine(line) ? 'operational' : 'sellable') + '::' + (line.calculationInputs as any).supplierId;
      externalGroups.set(group, [...(externalGroups.get(group) || []), line]);
    }
    for (const allocation of line.finalDonorAllocations || []) {
      if (allocation.qtyBaseUnits <= 0) continue;
      const group = allocation.branchId + '::' + (isOperationalAutoLine(line) ? 'OPERATIONAL' : 'SELLABLE');
      transferGroups.set(group, [...(transferGroups.get(group) || []), { line, quantity: allocation.qtyBaseUnits }]);
    }
  }

  for (const [group, items] of externalGroups) {
    const supplierId = group.split('::').slice(1).join('::');
    const inventoryClass = isOperationalAutoLine(items[0]) ? 'OPERATIONAL' : 'SELLABLE';
    const stablePart = (runId + '_' + group).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);
    const orderRef = doc(database, 'stock_orders', getHqAutoOrderId(runId, group));
    const suffix = supplierId.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase() || 'GEN';
    const orderNumber = (aggregate ? 'HQR-' : 'ORD-') + runId.slice(-6) + '-' + suffix;
    const emergency = Number(run.configuration.temporaryDemandMultiplier || 1) > 1;
    const total = items.reduce((sum, item) =>
      sum + item.finalPurchasePacks * Number(item.calculationInputs?.costPricePerPack || 0), 0);
    plannedOrders.push({ ref: orderRef, data: {
      tenantId, inventoryClass, order_number: orderNumber, requesting_branch_id: destinationBranchId,
      requesting_branch_name: aggregate ? 'HQ Central Store' : '',
      supplier_id: supplierId, order_type: emergency ? 'emergency' : 'monthly',
      category: inventoryClass === 'OPERATIONAL' ? 'non_sellable' : 'sellable_non_cosmetic',
      generation_method: 'auto_generated', status: aggregate ? 'submitted' : 'draft',
      is_emergency: emergency, submitted_by: userId, total_order_value_ugx: total,
      createdAt: timestamp, created_at: timestamp, submitted_at: aggregate ? timestamp : null,
      created_by: userId, autoGenerateRunId: runId
    } });
    orderIds.push(orderRef.id);
    for (const item of items) {
      const lineRef = doc(database, 'stock_order_lines',
        ('auto_line_' + stablePart + '_' + item.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)).slice(0, 480));
      plannedOrderLines.push({ ref: lineRef, data: {
        tenantId, inventoryClass,
        ...(isOperationalAutoLine(item) && item.masterItemId ? { masterItemId: item.masterItemId } : {}),
        order_id: orderRef.id, product_id: item.productId, product_name: item.productName,
        qty_ordered: item.finalPurchasePacks,
        unit_cost_ugx: Number(item.calculationInputs?.costPricePerPack || 0),
        line_total_ugx: item.finalPurchasePacks * Number(item.calculationInputs?.costPricePerPack || 0),
        line_status: aggregate ? 'pending' : 'ordered', isOperational: isOperationalAutoLine(item),
        createdAt: timestamp
      } });
    }
  }

  for (const [group, items] of transferGroups) {
    const sep = group.lastIndexOf('::');
    const donorId = group.slice(0, sep);
    const inventoryClass = group.slice(sep + 2) === 'OPERATIONAL' ? 'OPERATIONAL' : 'SELLABLE';
    const stablePart = (runId + '_' + donorId + '_' + destinationBranchId + '_' + inventoryClass)
      .replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);
    const transferRef = doc(database, 'transfer_invoices', 'auto_transfer_' + stablePart);
    plannedTransfers.push({ ref: transferRef, data: {
      tenantId, inventoryClass,
      transfer_number: 'TRF-' + runId.slice(-6) + '-' +
        (donorId.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase() || 'SRC'),
      source_branch_id: donorId, destination_branch_id: destinationBranchId,
      status: 'pending_approval', created_by: userId, dispatched_by: '', received_by: '',
      createdAt: timestamp, autoGenerateRunId: runId
    } });
    transferIds.push(transferRef.id);
    for (const { line, quantity } of items) {
      plannedTransferLines.push({ ref: doc(database, 'transfer_invoice_lines',
        ('auto_transfer_line_' + stablePart + '_' +
          String(line.id || line.productId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)).slice(0, 480)),
        data: {
          tenantId, inventoryClass, transfer_id: transferRef.id, product_id: line.productId,
          product_name: line.productName, qty_requested: quantity,
          qty_dispatched: 0, qty_received: 0,
          unit_cost_ugx: Number(line.calculationInputs?.costPricePerPack || 0),
          createdAt: timestamp
        }
      });
    }
    const reservations = await getDocs(query(collection(database, 'inventoryTransferReservations'),
      where('tenantId', '==', tenantId), where('autoGenerateRunId', '==', runId),
      where('sourceBranchId', '==', donorId)));
    const productIds = new Set(items.map(item => item.line.productId));
    for (const snapshot of reservations.docs.filter(snapshot => productIds.has(String(snapshot.data().productId)))) {
      reservationRefs.push(snapshot.ref);
      reservationSources.set(snapshot.ref.path, { donorId, inventoryClass });
    }
  }

  const documents = [...plannedOrders, ...plannedOrderLines, ...plannedTransfers, ...plannedTransferLines];
  const refs = [...documents.map(item => item.ref), ...reservationRefs];
  // Leave room for the run and immutable audit record. Firestore transactions are limited to 500 writes.
  if (refs.length + 2 > 450) throw new Error('Order is too large for one atomic submission. Split the run into smaller orders.');
  if (new Set(refs.map(ref => ref.path)).size !== refs.length)
    throw new Error('Duplicate generated document identity; order submission cancelled.');
  const auditRef = doc(database, 'global_audit_logs',
    'auto_order_submit_' + runId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180));

  // All reads precede writes and every document is committed atomically.
  // A denied write leaves no partial orders, transfers, reservations, or success status.
  await runTransaction(database, async tx => {
    // The run is the sole idempotency gate. Security rules permit its read for tenant members;
    // they do not permit reading missing purchase-order / transfer IDs as ordinary branch users.
    const latest = await tx.get(runRef);
    if (!latest.exists()) throw new Error('Run disappeared before submission.');
    const liveRun = latest.data() as AutoGenerateOrderRun;
    if (liveRun.tenantId !== tenantId || liveRun.branchId !== destinationBranchId)
      throw new Error('Run scope changed; recalculate before submission.');
    if (liveRun.status === 'SUBMITTED') return;
    if (liveRun.status !== 'READY') throw new Error('Replenishment run is no longer ready.');
    const reservationSnapshots = await Promise.all(reservationRefs.map(ref => tx.get(ref)));
    for (let index = 0; index < reservationRefs.length; index++) {
      const snapshot = reservationSnapshots[index];
      if (!snapshot.exists()) throw new Error('A transfer reservation expired or was removed. Recalculate first.');
      const reservation = snapshot.data();
      const source = reservationSources.get(reservationRefs[index].path);
      const matchedTransfer = plannedTransfers.find(item =>
        item.data.source_branch_id === source?.donorId && item.data.inventoryClass === source?.inventoryClass);
      if (!matchedTransfer) throw new Error('Reservation cannot be matched to a transfer.');
      if (reservation.status === 'CONVERTED' || reservation.convertedTransferRequestId)
        throw new Error('A transfer reservation was already converted. Reconcile before retrying.');
      if (!['ACTIVE', 'PENDING'].includes(reservation.status))
        throw new Error('A transfer reservation is no longer active. Recalculate the order.');
    }

    // These writes, the reservation conversions, status change and audit record are atomic.
    for (const item of documents) tx.set(item.ref, item.data);
    for (const ref of reservationRefs) {
      const path = ref.path;
      // The reservation query already bound donor groups; select the matching transfer
      // from the planned transfer set, rather than deriving a transfer from a document ID.
      const selected = plannedTransfers.find(item => item.data.source_branch_id ===
        reservationSources.get(path)?.donorId && item.data.inventoryClass ===
        reservationSources.get(path)?.inventoryClass);
      if (!selected) throw new Error('Reservation has no matching planned transfer.');
      tx.update(ref, { status: 'CONVERTED', convertedTransferRequestId: selected.ref.id, updatedAt: timestamp });
    }
    tx.update(runRef, { status: 'SUBMITTED', submittedAt: timestamp, updatedAt: timestamp,
      submittedOrderIds: orderIds, submittedTransferIds: transferIds });
    tx.set(auditRef, {
      tenantId, action: 'AUTO_GENERATE_ORDER_SUBMITTED', category: 'PROCUREMENT',
      description: 'Auto-generated order run ' + runId + ' submitted. Created ' +
        orderIds.length + ' purchase orders and ' + transferIds.length + ' interbranch transfers.',
      actor: userEmail, timestamp, ipAddress: 'client-side', device: 'PharmHelm Pro ERP Console'
    });
  });
  return { orderIds, transferIds };
}
