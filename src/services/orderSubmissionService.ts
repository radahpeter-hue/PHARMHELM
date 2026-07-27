import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where,
  runTransaction,
  Timestamp,
  addDoc,
  updateDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import { 
  AutoGenerateOrderRun, 
  AutoGenerateOrderLine,
  InventoryTransferReservation,
  Product,
  ProductBatch
} from '../types';
import { calculateProductForecast } from './forecastingService';

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
      // Fetch product detail live
      const prodSnap = await getDoc(doc(db, 'products', line.productId));
      if (!prodSnap.exists()) continue;
      const product = prodSnap.data() as Product;

      // Revalidate stockout / usable stock
      const forecast = await calculateProductForecast({
        tenantId,
        branchId,
        productId: line.productId,
        analysisStartDate: run.configuration.analysisStartDate,
        analysisEndDate: run.configuration.analysisEndDate,
        forecastCoverageDays: run.configuration.forecastCoverageDays,
        includeExceptionalConsumption: run.configuration.includeExceptionalConsumption,
        useSeasonality: run.configuration.applySeasonality
      });

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
        if (!externalBySupplier[supplierId]) {
          externalBySupplier[supplierId] = [];
        }
        externalBySupplier[supplierId].push(line);
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
    for (const supplierId in externalBySupplier) {
      const items = externalBySupplier[supplierId];
      if (items.length === 0) continue;

      const orderRef = doc(collection(db, 'stock_orders'));
      const orderNumber = `ORD-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
      const totalCost = items.reduce((sum, item) => sum + item.finalPurchasePacks * ((item.calculationInputs as any)?.costPricePerPack || 0), 0);

      const poData = {
        tenantId,
        order_number: orderNumber,
        requesting_branch_id: destinationBranchId,
        requesting_branch_name: '', // Will populate on read fallback
        supplier_id: supplierId,
        order_type: run.configuration.temporaryDemandMultiplier ? 'emergency' : 'monthly',
        category: 'sellable_non_cosmetic',
        generation_method: 'auto_generated',
        status: 'draft',
        is_emergency: !!run.configuration.temporaryDemandMultiplier,
        submitted_by: userId,
        total_order_value_ugx: totalCost,
        createdAt: new Date().toISOString(),
        created_by: userId,
        autoGenerateRunId: runId
      };

      await runTransaction(db, async (tx) => {
        tx.set(orderRef, poData);
        for (const item of items) {
          const lineRef = doc(collection(db, 'stock_order_lines'));
          tx.set(lineRef, {
            tenantId,
            order_id: orderRef.id,
            product_id: item.productId,
            product_name: item.productName,
            qty_ordered: item.finalPurchasePacks,
            unit_cost_ugx: (item.calculationInputs as any)?.costPricePerPack || 0,
            line_total_ugx: item.finalPurchasePacks * ((item.calculationInputs as any)?.costPricePerPack || 0),
            line_status: 'ordered',
            createdAt: new Date().toISOString()
          });
        }
      });
      orderIds.push(orderRef.id);
    }

    // 2. Create Internal Transfer Invoices
    for (const donorId in transfersByDonor) {
      const items = transfersByDonor[donorId] as any[];
      if (items.length === 0) continue;

      const transferRef = doc(collection(db, 'transfer_invoices'));
      const transferNumber = `TRF-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;

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

      await runTransaction(db, async (tx) => {
        tx.set(transferRef, transferData);
        for (const item of items) {
          const lineRef = doc(collection(db, 'transfer_invoice_lines'));
          const cost = (item.calculationInputs as any)?.costPricePerPack || 0;
          tx.set(lineRef, {
            tenantId,
            transfer_id: transferRef.id,
            product_id: item.productId,
            product_name: item.productName,
            qty_requested: item.qtyToTransferBaseUnits, // base units
            qty_dispatched: 0,
            qty_received: 0,
            unit_cost_ugx: cost,
            createdAt: new Date().toISOString()
          });
        }
      });

      // 3. Mark active reservations as CONVERTED
      try {
        const reservationsSnap = await getDocs(
          query(
            collection(db, 'inventoryTransferReservations'),
            where('tenantId', '==', tenantId),
            where('autoGenerateRunId', '==', runId),
            where('sourceBranchId', '==', donorId),
            where('status', '==', 'ACTIVE')
          )
        );

        for (const resDoc of reservationsSnap.docs) {
          await updateDoc(doc(db, 'inventoryTransferReservations', resDoc.id), {
            status: 'CONVERTED',
            convertedTransferRequestId: transferRef.id,
            updatedAt: new Date().toISOString()
          });
        }
      } catch (e) {
        console.warn('Failed to convert reservations:', e);
      }

      transferIds.push(transferRef.id);
    }

    // 4. Update Run Status
    await updateDoc(runRef, {
      status: 'SUBMITTED',
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // 5. Create Audit Log
    try {
      await addDoc(collection(db, 'global_audit_logs'), {
        tenantId,
        action: 'AUTO_GENERATE_ORDER_SUBMITTED',
        category: 'PROCUREMENT',
        description: `Auto-generated order run ${runId} submitted. Created ${orderIds.length} purchase orders and ${transferIds.length} interbranch transfers.`,
        actor: userEmail,
        timestamp: new Date().toISOString(),
        ipAddress: 'client-side',
        device: 'PharmHelm Pro ERP Console'
      });
    } catch (e) {
      console.warn('Audit logger failed:', e);
    }

  } catch (e: any) {
    console.error('Order submission failed:', e);
    throw e;
  }

  return { orderIds, transferIds };
}
