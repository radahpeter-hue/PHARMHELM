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

    let totalBudgetCost = 0;

    for (const line of lines) {
      if (line.isOperational) {
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
export async function submitOrderRun(runId: string, userId: string, userEmail: string): Promise<{
  orderIds: string[];
  transferIds: string[];
}> {
  const orderIds: string[] = [];
  const transferIds: string[] = [];

  // Run everything in a secure single db transaction or sequence of operations
  try {
    const runRef = doc(db, 'autoGenerateOrderRuns', runId);
    const runSnap = await getDoc(runRef);
    if (!runSnap.exists()) {
      throw new Error('Run snapshot does not exist');
    }
    const run = runSnap.data() as AutoGenerateOrderRun;
    if (run.status === 'SUBMITTED') {
      return { orderIds: [], transferIds: [] };
    }
    const tenantId = run.tenantId;
    const destinationBranchId = run.branchId;

    // Load lines
    const linesSnap = await getDocs(
      query(
        collection(db, 'autoGenerateOrderLines'),
        where('tenantId', '==', tenantId),
        where('runId', '==', runId)
      )
    );
    const lines = linesSnap.docs.map(d => ({ id: d.id, ...d.data() } as AutoGenerateOrderLine & { id: string }));

    // Group items for external orders by supplier, and group internal transfers by donor branch
    const externalBySupplier: Record<string, typeof lines> = {};
    const transfersByDonor: Record<string, typeof lines> = {};

    lines.forEach(line => {
      // External draft (requires positive purchase quantity)
      if (line.finalPurchasePacks > 0) {
        const supplierId = (line.calculationInputs as any)?.supplierId || 'unknown_supplier';
        const groupKey = `${line.isOperational ? 'operational' : 'sellable'}::${supplierId}`;
        if (!externalBySupplier[groupKey]) {
          externalBySupplier[groupKey] = [];
        }
        externalBySupplier[groupKey].push(line);
      }

      // Internal transfer draft
      if (line.finalInternalAllocation > 0) {
        // Group by donor allocations
        const allocations = line.finalDonorAllocations || [];
        allocations.forEach(alloc => {
          if (alloc.qtyBaseUnits > 0) {
            const donorId = alloc.branchId;
            if (!transfersByDonor[donorId]) {
              transfersByDonor[donorId] = [];
            }
            // Create a fake cloned line specific to this donor for splitting
            const donorLine = {
              ...line,
              qtyToTransferBaseUnits: alloc.qtyBaseUnits
            };
            (transfersByDonor[donorId] as any).push(donorLine);
          }
        });
      }
    });

    // Write all documents in a transaction sequence
    // 1. Create External Purchase Orders
    for (const groupKey in externalBySupplier) {
      const items = externalBySupplier[groupKey];
      if (items.length === 0) continue;
      const supplierId = groupKey.split('::').slice(1).join('::');

      const isHqAggregate = run.configuration.demandScope === 'all_branches';
      const stableOrderPart = `${runId}_${groupKey}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);
      const orderRef = doc(db, 'stock_orders', getHqAutoOrderId(runId, groupKey));
      const supplierSuffix = supplierId.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase() || 'GEN';
      const orderNumber = isHqAggregate ? `HQR-${runId.slice(-6)}-${supplierSuffix}` : `ORD-${runId.slice(-6)}-${supplierSuffix}`;
      const totalCost = items.reduce((sum, item) => sum + item.finalPurchasePacks * ((item.calculationInputs as any)?.costPricePerPack || 0), 0);
      const now = new Date().toISOString();
      const isEmergency = Number(run.configuration.temporaryDemandMultiplier || 1) > 1;

      const poData = {
        tenantId,
        order_number: orderNumber,
        requesting_branch_id: destinationBranchId,
        requesting_branch_name: isHqAggregate ? 'HQ Central Store' : '', // Will populate on read fallback
        supplier_id: supplierId,
        order_type: isEmergency ? 'emergency' : 'monthly',
        category: items.every(item => item.isOperational) ? 'non_sellable' : 'sellable_non_cosmetic',
        generation_method: 'auto_generated',
        status: isHqAggregate ? 'submitted' : 'draft',
        is_emergency: isEmergency,
        submitted_by: userId,
        total_order_value_ugx: totalCost,
        createdAt: now,
        created_at: now,
        submitted_at: isHqAggregate ? now : null,
        created_by: userId,
        autoGenerateRunId: runId
      };

      await runTransaction(db, async (tx) => {
        const lineRefs = items.map(item =>
          doc(db, 'stock_order_lines', `auto_line_${stableOrderPart}_${item.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)}`)
        );
        const snapshots = await Promise.all([
          tx.get(orderRef),
          ...lineRefs.map(lineRef => tx.get(lineRef))
        ]);
        if (!snapshots[0].exists()) tx.set(orderRef, poData);
        items.forEach((item, index) => {
          if (snapshots[index + 1].exists()) return;
          tx.set(lineRefs[index], {
            tenantId,
            order_id: orderRef.id,
            product_id: item.productId,
            product_name: item.productName,
            qty_ordered: item.finalPurchasePacks,
            unit_cost_ugx: (item.calculationInputs as any)?.costPricePerPack || 0,
            line_total_ugx: item.finalPurchasePacks * ((item.calculationInputs as any)?.costPricePerPack || 0),
            line_status: isHqAggregate ? 'pending' : 'ordered',
            isOperational: !!item.isOperational,
            createdAt: now
          });
        });
      });
      orderIds.push(orderRef.id);
    }

    // 2. Create Internal Transfer Invoices
    for (const donorId in transfersByDonor) {
      const items = transfersByDonor[donorId] as any[];
      if (items.length === 0) continue;

      const stableTransferPart = `${runId}_${donorId}_${destinationBranchId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);
      const transferRef = doc(db, 'transfer_invoices', `auto_transfer_${stableTransferPart}`);
      const transferNumber = `TRF-${runId.slice(-6)}-${donorId.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase() || 'SRC'}`;

      const transferData = {
        tenantId,
        transfer_number: transferNumber,
        source_branch_id: donorId,
        destination_branch_id: destinationBranchId,
        status: 'pending_approval',
        created_by: userId,
        dispatched_by: '',
        received_by: '',
        createdAt: new Date().toISOString(),
        autoGenerateRunId: runId
      };

      const lineRefs = items.map(item => doc(db, 'transfer_invoice_lines', `auto_transfer_line_${stableTransferPart}_${String(item.id || item.productId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)}`));
      const reservationsSnap = await getDocs(query(
        collection(db, 'inventoryTransferReservations'),
        where('tenantId', '==', tenantId), where('autoGenerateRunId', '==', runId), where('sourceBranchId', '==', donorId)
      ));
      const reservationRefs = reservationsSnap.docs.map(snapshot => snapshot.ref);

      await runTransaction(db, async tx => {
        const snapshots = await Promise.all([tx.get(transferRef), ...lineRefs.map(ref => tx.get(ref)), ...reservationRefs.map(ref => tx.get(ref))]);
        if (!snapshots[0].exists()) tx.set(transferRef, transferData);
        items.forEach((item, index) => {
          if (snapshots[index + 1].exists()) return;
          const cost = (item.calculationInputs as any)?.costPricePerPack || 0;
          tx.set(lineRefs[index], { tenantId, transfer_id: transferRef.id, product_id: item.productId, product_name: item.productName, qty_requested: item.qtyToTransferBaseUnits, qty_dispatched: 0, qty_received: 0, unit_cost_ugx: cost, createdAt: new Date().toISOString() });
        });
        reservationRefs.forEach((ref, index) => {
          const snapshot = snapshots[1 + lineRefs.length + index];
          if (!snapshot.exists()) return;
          const reservation = snapshot.data();
          if (reservation.status === 'CONVERTED' && reservation.convertedTransferRequestId && reservation.convertedTransferRequestId !== transferRef.id) throw new Error('A stock reservation was already converted into a different transfer request.');
          if (['ACTIVE', 'PENDING', 'CONVERTED'].includes(reservation.status)) tx.update(ref, { status: 'CONVERTED', convertedTransferRequestId: transferRef.id, updatedAt: new Date().toISOString() });
        });
      });

      transferIds.push(transferRef.id);
    }

    const submittedAt = new Date().toISOString();
    await runTransaction(db, async tx => {
      const latestRun = await tx.get(runRef);
      if (!latestRun.exists()) throw new Error('Run snapshot disappeared during submission.');
      tx.update(runRef, { status: 'SUBMITTED', submittedAt, updatedAt: submittedAt, submittedOrderIds: orderIds, submittedTransferIds: transferIds });
      tx.set(doc(db, 'global_audit_logs', `auto_order_submit_${runId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180)}`), {
        tenantId, action: 'AUTO_GENERATE_ORDER_SUBMITTED', category: 'PROCUREMENT',
        description: `Auto-generated order run ${runId} submitted. Created ${orderIds.length} purchase orders and ${transferIds.length} interbranch transfers.`,
        actor: userEmail, timestamp: submittedAt, ipAddress: 'client-side', device: 'PharmHelm Pro ERP Console'
      }, { merge: true });
    });

  } catch (e: any) {
    console.error('Order submission failed:', e);
    throw e;
  }

  return { orderIds, transferIds };
}
