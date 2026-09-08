from pathlib import Path

SALES = Path('src/pages/Sales.tsx')
CONSUMPTION = Path('src/services/consumptionService.ts')
INTEGRITY = Path('src/services/saleInventoryIntegrityService.ts')

sales = SALES.read_text()
consumption = CONSUMPTION.read_text()
integrity = INTEGRITY.read_text()

marker = "from '../services/posCheckoutTierService'"
if marker not in sales:
    import_anchor = "import { buildTierCartItem, getCartLineIdentity, getProductUsableBaseStock, getReservedBaseQuantityForProduct, mergeTierCartItem, replaceTierCartPrice, replaceTierCartQuantity } from '../services/posTierCartService';\n"
    import_line = "import { allocateFefoCheckoutLines, assertCheckoutLineCostFloors, buildCheckoutLineDemands, finalizeCheckoutSaleItems, getCheckoutBatchDeductions, getCheckoutProductDeductions } from '../services/posCheckoutTierService';\n"
    if import_anchor not in sales:
        raise SystemExit('Sales import anchor not found')
    sales = sales.replace(import_anchor, import_anchor + import_line, 1)

    checkout_block = """    if (systemSettings?.features?.multiTierSellingEnabled === true && cart.some(item => !item.isService && item.tierCode)) {
      toast.error('Multi-tier basket selection is ready, but checkout is blocked until transactional tier-level FEFO integration is completed. No stock has been deducted.');
      return;
    }

"""
    if checkout_block not in sales:
        raise SystemExit('Phase C checkout block anchor not found')
    sales = sales.replace(checkout_block, '', 1)

    sales = sales.replace(
        "const belowCostItem = cart.find(item => !item.isService && item.unitPrice < item.costPrice);",
        "const belowCostItem = cart.find(item => !item.isService && !item.tierCode && item.unitPrice < item.costPrice);"
    )

    allocation_start = sales.find("          const allocationsByProduct = new Map<string, Array<{ batchId: string; batchNumber: string; expiryDate?: string; baseQuantity: number; costPerBaseUnit: number }>>();")
    allocation_end = sales.find("          // Apply FEFO batch deductions.", allocation_start)
    if allocation_start < 0 or allocation_end < 0:
        raise SystemExit('Checkout allocation block anchors not found')

    new_allocation = """          const liveProducts = new Map<string, Product>();
          const productNames = new Map<string, string>();
          const checkoutBatchesByProduct = new Map<string, any[]>();

          for (const productId of uniqueProductIds) {
            const snapshot = productSnapshots.get(productId);
            if (!snapshot?.exists()) throw new Error(`Product ${productId} no longer exists.`);
            const liveProduct = { id: productId, ...snapshot.data() } as Product;
            if (liveProduct.tenantId !== profile.tenantId) throw new Error(`Product tenant mismatch for ${liveProduct.name || productId}.`);
            liveProducts.set(productId, liveProduct);
            productNames.set(productId, liveProduct.name || productMap.get(productId)?.name || productId);

            const candidates = (batchSnapshotsByProduct.get(productId) || [])
              .filter(row => row.data.tenantId === profile.tenantId && row.data.branchId === activeBranchId)
              .filter(row => String(row.data.batch_status || '').toLowerCase() === 'active')
              .filter(row => isInventoryBatchUnexpired(row.data.expiryDate))
              .filter(row => Number(row.data.quantity || 0) > 0)
              .map(row => ({
                id: row.id,
                tenantId: String(row.data.tenantId || ''),
                branchId: String(row.data.branchId || ''),
                productId,
                batchNumber: String(row.data.batchNumber || 'UNSPECIFIED'),
                expiryDate: row.data.expiryDate,
                batchStatus: String(row.data.batch_status || ''),
                quantity: Number(row.data.quantity || 0),
                costPerBaseUnit: Number(row.data.purchasePrice || 0)
              }));
            checkoutBatchesByProduct.set(productId, candidates);
          }

          const checkoutDemands = buildCheckoutLineDemands({
            items: saleData.items,
            liveProducts,
            settings: systemSettings,
            tenantId: profile.tenantId,
            branchId: activeBranchId!
          });
          const lineAllocations = allocateFefoCheckoutLines({
            demands: checkoutDemands,
            batchesByProduct: checkoutBatchesByProduct,
            productNames
          });
          assertCheckoutLineCostFloors({
            items: saleData.items,
            allocations: lineAllocations,
            discountPercentage,
            productNames
          });
          const productDeductions = getCheckoutProductDeductions(checkoutDemands);
          const batchDeductions = getCheckoutBatchDeductions(lineAllocations);

"""
    sales = sales[:allocation_start] + new_allocation + sales[allocation_end:]

    apply_start = sales.find("          // Apply FEFO batch deductions.")
    aggregate_comment = sales.find("          // Keep product aggregate stock synchronized with base-unit batch deductions.", apply_start)
    if apply_start < 0 or aggregate_comment < 0:
        raise SystemExit('Batch deduction block anchors not found')
    new_apply = """          // Apply exact FEFO batch deductions once, even when several commercial lines share a product.
          for (const [productId, deductions] of batchDeductions) {
            const rows = batchSnapshotsByProduct.get(productId) || [];
            for (const [batchId, deduction] of deductions) {
              const row = rows.find(candidate => candidate.id === batchId);
              if (!row) throw new Error(`Allocated batch ${batchId} disappeared during checkout.`);
              const available = Number(row.data.quantity || 0);
              if (deduction > available) throw new Error(`Allocated batch ${row.data.batchNumber || batchId} changed during checkout. Retry the sale.`);
              transaction.update(row.ref, { quantity: available - deduction, updatedAt: serverTimestamp() });
            }
          }

"""
    sales = sales[:apply_start] + new_apply + sales[aggregate_comment:]

    finalize_start = sales.find("          finalizedSaleItems = saleData.items.map(item => {")
    clean_start = sales.find("          const cleanSaleData = JSON.parse(JSON.stringify({ ...saleData, items: finalizedSaleItems }));", finalize_start)
    if finalize_start < 0 or clean_start < 0:
        raise SystemExit('Finalized sale item block anchors not found')
    sales = sales[:finalize_start] + "          finalizedSaleItems = finalizeCheckoutSaleItems(saleData.items, lineAllocations);\n\n" + sales[clean_start:]

SALES.write_text(sales)

consumption_marker = 'function snapshotBaseQuantityForSaleItem'
if consumption_marker not in consumption:
    function_start = consumption.find('export async function logSaleMovements(')
    next_comment = consumption.find('/**\n * Reconciles durable sales', function_start)
    if function_start < 0 or next_comment < 0:
        raise SystemExit('Consumption logSaleMovements anchors not found')
    replacement = r'''function snapshotBaseQuantityForSaleItem(item: SaleItem): number | null {
  const quantity = Number(item.commercialQuantity ?? item.quantity ?? 0);
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Sale item quantity is invalid.');

  const explicitBaseQuantity = Number(item.baseQuantity);
  if (Number.isFinite(explicitBaseQuantity) && explicitBaseQuantity > 0) return explicitBaseQuantity;

  const tierMultiplier = Number(item.tierMultiplier);
  if (item.tierCode) {
    if (!Number.isFinite(tierMultiplier) || tierMultiplier <= 0) {
      throw new Error(`Historical tier multiplier is missing for ${item.productName || item.productId}.`);
    }
    return quantity * tierMultiplier;
  }

  return null;
}

/**
 * Logs sale movement events (SALE or SALE_REVERSAL) and updates branchConsumptionDaily summaries.
 * Tier-aware sales always use the immutable sale-line baseQuantity/tierMultiplier snapshot.
 * Only pre-multi-tier legacy lines fall back to the current Product unitOfSell multiplier.
 */
export async function logSaleMovements(
  saleId: string,
  saleData: Sale,
  isReversal: boolean,
  reversalOfEventId: string | null = null,
  createdBy: string = 'system',
  stockAlreadyApplied: boolean = false
) {
  const itemsByProduct = new Map<string, SaleItem[]>();
  for (const item of saleData.items.filter(item => !item.isService)) {
    const rows = itemsByProduct.get(item.productId) || [];
    rows.push(item);
    itemsByProduct.set(item.productId, rows);
  }
  if (itemsByProduct.size === 0) return;

  // Use one deterministic idempotent transaction per product. Multiple tier lines for
  // the same product are summed in base units without re-reading current packaging.
  for (const [productId, items] of itemsByProduct) {
    const batchRefs = await getBranchProductBatchRefs(saleData.tenantId, saleData.branchId, productId);

    await runTransaction(db, async (transaction) => {
      let liveProduct: Product | null = null;
      let baseUnits = 0;

      for (const item of items) {
        const snapshotBaseUnits = snapshotBaseQuantityForSaleItem(item);
        if (snapshotBaseUnits !== null) {
          baseUnits += snapshotBaseUnits;
          continue;
        }

        // Backward compatibility only for receipts created before immutable tier/base snapshots existed.
        if (!liveProduct) {
          const productSnap = await transaction.get(doc(db, 'products', productId));
          liveProduct = productSnap.exists() ? (productSnap.data() as Product) : null;
        }
        const quantity = Number(item.quantity || 0);
        baseUnits += quantity * (liveProduct ? getBaseUnitMultiplier(liveProduct) : 1);
      }

      const qtyDelta = isReversal ? baseUnits : -baseUnits;
      const consumptionDelta = isReversal ? -baseUnits : baseUnits;
      const eventType = isReversal ? 'SALE_REVERSAL' : 'SALE';

      await logMovementAndAggregateInTx(transaction, batchRefs, {
        tenantId: saleData.tenantId,
        branchId: saleData.branchId,
        productId,
        eventType,
        quantityDeltaBaseUnits: qtyDelta,
        consumptionDeltaBaseUnits: consumptionDelta,
        isExceptional: !!saleData.isExceptionalConsumption,
        exceptionalReason: saleData.isExceptionalConsumption ? (saleData.exceptionalConsumptionReason || 'Exceptional sale') : null,
        sourceCollection: 'sales',
        sourceDocumentId: saleId,
        sourceLineId: productId,
        reversalOfEventId,
        createdBy,
        effectiveAt: new Date(saleData.timestamp),
        stockAlreadyApplied,
        timezone: 'Africa/Kampala'
      });
    });
  }
}


'''
    consumption = consumption[:function_start] + replacement + consumption[next_comment:]

CONSUMPTION.write_text(consumption)

integrity_marker = 'Multi-tier receipt inventory revisions require exact batch-allocation support'
if integrity_marker not in integrity:
    revise_anchor = "export async function reviseSaleInventoryAtomically(input: ReviseSaleInventoryInput): Promise<void> {\n  if (!input.tenantId || !input.branchId || !input.saleId) throw new Error('Tenant, branch and sale identifiers are required for receipt revision.');\n"
    revise_replacement = revise_anchor + "  if ([...(input.originalSale.items || []), ...(input.updatedItems || [])].some(item => !item.isService && Boolean(item.tierCode))) {\n    throw new Error('Multi-tier receipt inventory revisions require exact batch-allocation support and are temporarily disabled until the receipt-edit integration phase.');\n  }\n"
    if revise_anchor not in integrity:
        raise SystemExit('Revise integrity anchor not found')
    integrity = integrity.replace(revise_anchor, revise_replacement, 1)

    void_anchor = "export async function voidSaleInventoryAtomically(input: VoidSaleInventoryInput): Promise<boolean> {\n  if (!input.tenantId || !input.branchId || !input.sale.id) throw new Error('Tenant, branch and sale identifiers are required to void a sale.');\n"
    void_replacement = void_anchor + "  if ((input.sale.items || []).some(item => !item.isService && Boolean(item.tierCode))) {\n    throw new Error('Multi-tier receipt voiding requires exact stored batch-allocation restoration and is temporarily disabled until the receipt-edit integration phase.');\n  }\n"
    if void_anchor not in integrity:
        raise SystemExit('Void integrity anchor not found')
    integrity = integrity.replace(void_anchor, void_replacement, 1)

INTEGRITY.write_text(integrity)
print('Phase D source transformations applied.')
