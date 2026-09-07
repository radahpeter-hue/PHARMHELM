from pathlib import Path
import re


def replace_one(path, pattern, replacement, label, flags=0):
    p = Path(path)
    text = p.read_text()
    new, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 replacement, got {count}')
    p.write_text(new)
    print('patched:', label)


def replace_literal(path, old, new, label):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise RuntimeError(f'{label}: target not found')
    p.write_text(text.replace(old, new, 1))
    print('patched:', label)

# ---------- Types ----------
replace_literal(
    'src/types.ts',
    "  expiryDate?: string;\n}",
    "  expiryDate?: string;\n  batchAllocations?: Array<{ batchId: string; batchNumber: string; expiryDate?: string; baseQuantity: number; costPerBaseUnit: number }>;\n}\n",
    'SaleItem FEFO allocation metadata'
)

# ---------- Consumption service ----------
consumption_path = 'src/services/consumptionService.ts'
replace_literal(
    consumption_path,
    "  runTransaction\n} from 'firebase/firestore';",
    "  runTransaction,\n  getDoc\n} from 'firebase/firestore';",
    'consumption getDoc import'
)

replace_literal(
    consumption_path,
    "export function getBaseUnitMultiplier(product: Product): number {",
    "export function isInventoryBatchUnexpired(expiryDate?: string, now: Date = new Date()): boolean {\n  if (!expiryDate) return true;\n  const raw = String(expiryDate).trim();\n  if (!raw) return true;\n\n  // Regulatory stock records frequently store YYYY-MM-DD or YYYY-MM.\n  // A dated batch remains usable through the end of its recorded expiry day,\n  // while month-only expiry remains usable through the final day of the month.\n  let expiry: Date;\n  if (/^\\d{4}-\\d{2}$/.test(raw)) {\n    const [year, month] = raw.split('-').map(Number);\n    expiry = new Date(year, month, 0, 23, 59, 59, 999);\n  } else if (/^\\d{4}-\\d{2}-\\d{2}$/.test(raw)) {\n    const [year, month, day] = raw.split('-').map(Number);\n    expiry = new Date(year, month - 1, day, 23, 59, 59, 999);\n  } else {\n    expiry = new Date(raw);\n    if (Number.isNaN(expiry.getTime())) return false;\n  }\n  return expiry.getTime() >= now.getTime();\n}\n\nexport function getBaseUnitMultiplier(product: Product): number {",
    'canonical inventory expiry helper'
)

replace_literal(
    consumption_path,
    "      const isUnexpired = batch.expiryDate ? new Date(batch.expiryDate) > new Date() : true;",
    "      const isUnexpired = isInventoryBatchUnexpired(batch.expiryDate);",
    'consumption expiry semantics'
)

reconcile_code = r'''

/**
 * Reconciles durable sales against deterministic movement events.
 * Safe to call repeatedly because logSaleMovements uses deterministic event IDs.
 * Voided sales are guaranteed to have both the original SALE and SALE_REVERSAL events,
 * producing a net-zero consumption effect while preserving the audit trail.
 */
export async function reconcileSaleConsumptionMovements(params: {
  tenantId: string;
  branchId: string;
  createdBy?: string;
  maxSales?: number;
}): Promise<{ checked: number; repaired: number; failures: number }> {
  const { tenantId, branchId, createdBy = 'system-reconciliation', maxSales = 100 } = params;
  if (!tenantId || !branchId) return { checked: 0, repaired: 0, failures: 0 };

  const salesSnap = await getDocs(query(
    collection(db, 'sales'),
    where('tenantId', '==', tenantId),
    where('branchId', '==', branchId)
  ));

  const candidateDocs = salesSnap.docs
    .filter(d => ['completed', 'voided'].includes(String(d.data().status || '').toLowerCase()))
    .sort((a, b) => new Date(String(b.data().timestamp || 0)).getTime() - new Date(String(a.data().timestamp || 0)).getTime())
    .slice(0, maxSales);

  let repaired = 0;
  let failures = 0;

  for (const saleDoc of candidateDocs) {
    const sale = { id: saleDoc.id, ...saleDoc.data() } as Sale;
    try {
      const productIds = Array.from(new Set((sale.items || []).filter(i => !i.isService).map(i => i.productId)));
      let missing = false;
      for (const productId of productIds) {
        const eventId = `sales_${sale.id}_${productId}_${productId}`;
        const eventSnap = await getDoc(doc(db, 'inventoryMovementEvents', eventId));
        if (!eventSnap.exists()) missing = true;
      }

      if (missing) {
        await logSaleMovements(sale.id, sale, false, null, createdBy, true);
        repaired += 1;
      }

      if (sale.status === 'voided') {
        let reversalMissing = false;
        for (const productId of productIds) {
          const reversalId = `sales_${sale.id}_${productId}_reversal_${productId}`;
          const reversalSnap = await getDoc(doc(db, 'inventoryMovementEvents', reversalId));
          if (!reversalSnap.exists()) reversalMissing = true;
        }
        if (reversalMissing) {
          await logSaleMovements(sale.id, sale, true, `sales_${sale.id}`, createdBy, true);
          repaired += 1;
        }
      }
    } catch (error) {
      failures += 1;
      console.warn(`Consumption reconciliation failed for sale ${sale.id}:`, error);
    }
  }

  return { checked: candidateDocs.length, repaired, failures };
}
'''
Path(consumption_path).write_text(Path(consumption_path).read_text() + reconcile_code)
print('patched: sale consumption reconciliation worker')

# ---------- Network fulfilment ----------
network_path = 'src/services/networkFulfilmentService.ts'
network_text = Path(network_path).read_text()
helper_marker = "/**\n * Calculates a potential donor branch's transferable excess stock.\n */"
helper = r'''/**
 * Returns confirmed outbound commitments for a branch/product across both
 * canonical transfer line documents and live transfer reservations.
 */
async function getConfirmedOutboundCommitments(
  tenantId: string,
  sourceBranchId: string,
  productId: string
): Promise<number> {
  const activeStatuses = new Set(['pending_approval', 'approved', 'dispatched', 'receiving', 'in_transit']);
  let transferQty = 0;

  const transferSnap = await getDocs(query(
    collection(db, 'transfer_invoices'),
    where('tenantId', '==', tenantId),
    where('source_branch_id', '==', sourceBranchId)
  ));
  const activeTransfers = transferSnap.docs.filter(d => activeStatuses.has(String(d.data().status || '').toLowerCase()));

  for (const transferDoc of activeTransfers) {
    const transfer = transferDoc.data() as any;
    const embeddedItems = Array.isArray(transfer.items) ? transfer.items : [];
    for (const item of embeddedItems) {
      if (item.product_id === productId) {
        transferQty += Math.max(0, Number(item.qty_dispatched ?? item.qty_requested ?? 0));
      }
    }

    const lineSnap = await getDocs(query(
      collection(db, 'transfer_invoice_lines'),
      where('tenantId', '==', tenantId),
      where('transfer_id', '==', transferDoc.id)
    ));
    lineSnap.forEach(lineDoc => {
      const line = lineDoc.data() as any;
      if (line.product_id === productId) {
        transferQty += Math.max(0, Number(line.qty_dispatched ?? line.qty_requested ?? 0));
      }
    });
  }

  let reservedQty = 0;
  const reservationsSnap = await getDocs(query(
    collection(db, 'inventoryTransferReservations'),
    where('tenantId', '==', tenantId),
    where('sourceBranchId', '==', sourceBranchId),
    where('productId', '==', productId),
    where('status', 'in', ['PENDING', 'ACTIVE'])
  ));
  const nowIso = new Date().toISOString();
  reservationsSnap.forEach(d => {
    const reservation = d.data() as InventoryTransferReservation;
    if (reservation.expiresAt > nowIso) {
      reservedQty += Math.max(0, Number(reservation.reservedQuantityBaseUnits || 0));
    }
  });

  return transferQty + reservedQty;
}

'''
if helper_marker not in network_text:
    raise RuntimeError('network commitment insertion marker missing')
network_text = network_text.replace(helper_marker, helper + helper_marker, 1)
Path(network_path).write_text(network_text)
print('patched: canonical network commitments helper')

replace_one(
    network_path,
    r"  // 2\. Query outstanding outbound transfer commitments \(dispatched or pending approvals\)[\s\S]*?  const confirmedOutboundCommitments = pendingTransfersQty \+ reservedQty;",
    "  // 2. Canonical commitments include embedded transfer lines, separate transfer_invoice_lines, and live reservations.\n  const confirmedOutboundCommitments = await getConfirmedOutboundCommitments(tenantId, donorBranchId, productId);",
    'donor commitments from canonical transfer lines',
    re.M
)

replace_literal(
    network_path,
    "          const hqCommitments = 0; // Simple stub\n          const hqAllocatable = Math.max(0, centralForecast.expiryAdjustedUsableStock - hqCommitments);",
    "          const hqCommitments = await getConfirmedOutboundCommitments(tenantId, hqBranchId, productId);\n          const hqAllocatable = Math.max(0, centralForecast.expiryAdjustedUsableStock - hqCommitments);",
    'HQ outbound commitments'
)

# Make reservation expiry parsing use explicit end-of-day/month logic.
replace_literal(
    network_path,
    "      const expiryMs = batch.expiryDate ? new Date(`${batch.expiryDate}T23:59:59`).getTime() : Number.POSITIVE_INFINITY;\n      if (['quarantined', 'expired', 'recalled', 'blocked'].includes(status)) return;\n      if (Number.isFinite(expiryMs) && expiryMs <= now.getTime()) return;",
    "      const rawExpiry = String(batch.expiryDate || '').trim();\n      let expiryMs = Number.POSITIVE_INFINITY;\n      if (/^\\d{4}-\\d{2}$/.test(rawExpiry)) {\n        const [year, month] = rawExpiry.split('-').map(Number);\n        expiryMs = new Date(year, month, 0, 23, 59, 59, 999).getTime();\n      } else if (/^\\d{4}-\\d{2}-\\d{2}$/.test(rawExpiry)) {\n        const [year, month, day] = rawExpiry.split('-').map(Number);\n        expiryMs = new Date(year, month - 1, day, 23, 59, 59, 999).getTime();\n      } else if (rawExpiry) {\n        expiryMs = new Date(rawExpiry).getTime();\n      }\n      if (['quarantined', 'expired', 'recalled', 'blocked'].includes(status)) return;\n      if (!Number.isFinite(expiryMs) || expiryMs < now.getTime()) return;",
    'reservation expiry date semantics'
)

# ---------- Sales POS ----------
sales_path = 'src/pages/Sales.tsx'
replace_literal(
    sales_path,
    "  logSaleMovements\n} from '../services/consumptionService';",
    "  logSaleMovements,\n  reconcileSaleConsumptionMovements,\n  isInventoryBatchUnexpired\n} from '../services/consumptionService';",
    'POS consumption imports'
)

# Ensure the product list and cart FEFO use the same expiry semantics.
replace_literal(
    sales_path,
    ".filter(b => new Date(b.expiryDate) > new Date()) // Never add expired batches",
    ".filter(b => isInventoryBatchUnexpired(b.expiryDate)) // Never add expired batches",
    'POS add-to-cart expiry filter'
)
replace_literal(
    sales_path,
    ".filter(b => new Date(b.expiryDate) > new Date())\n        .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());",
    ".filter(b => isInventoryBatchUnexpired(b.expiryDate))\n        .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());",
    'POS split-batch expiry filter'
)

replace_literal(
    sales_path,
    "      const product = products.find(p => p.id === item.productId);\n      // Assuming we have a way to check if product is POM/Controlled\n      return false; // Placeholder",
    "      const product = products.find(p => p.id === item.productId);\n      if (!product) return false;\n      const category = String(product.prescriptionCategory || '').trim().toLowerCase();\n      return category === 'controlled' || category === 'prescription only' || category === 'pom' || category === 'prescription-only'",
    'POM and controlled-drug enforcement'
)

# Background reconciliation of durable sale records into deterministic movement events.
reconcile_effect = """  useEffect(() => {\n    if (!profile?.tenantId || !activeBranchId) return;\n    reconcilePendingPosFinancials({\n      tenantId: profile.tenantId, branchId: activeBranchId, actorId: profile.uid,\n      actorName: profile.full_name || profile.displayName || 'POS Staff'\n    }).catch(error => console.warn('Pending POS finance reconciliation could not complete:', error));\n  }, [profile?.tenantId, profile?.uid, activeBranchId]);\n"""
reconcile_replacement = reconcile_effect + """\n  useEffect(() => {\n    if (!profile?.tenantId || !activeBranchId) return;\n    reconcileSaleConsumptionMovements({\n      tenantId: profile.tenantId,\n      branchId: activeBranchId,\n      createdBy: profile.uid,\n      maxSales: 100\n    }).catch(error => console.warn('Pending sale consumption reconciliation could not complete:', error));\n  }, [profile?.tenantId, profile?.uid, activeBranchId]);\n"""
replace_literal(sales_path, reconcile_effect, reconcile_replacement, 'POS consumption reconciliation trigger')

# True checkout-time FEFO: prefetch every batch reference for each product, then read and allocate
# from those references inside the same transaction that decrements stock and creates the sale.
replace_one(
    sales_path,
    r"        const saleRef = doc\(db, 'sales', saleDocumentId\);[\s\S]*?        \}, 'sales/product_batches/products'\);",
    r"""        const saleRef = doc(db, 'sales', saleDocumentId);
        const stockItems = cart.filter(item => !item.isService);
        const uniqueProductIds = Array.from(new Set(stockItems.map(item => item.productId)));
        const productMap = new Map(uniqueProductIds.map(productId => {
          const product = products.find(p => p.id === productId);
          if (!product) throw new Error(`Product ${productId} is missing. Refresh the page and try again.`);
          return [productId, product] as const;
        }));
        const batchRefsByProduct = new Map<string, { ref: any; id: string }[]>();
        for (const productId of uniqueProductIds) {
          batchRefsByProduct.set(productId, await getBranchProductBatchRefs(profile.tenantId, activeBranchId!, productId));
        }

        let finalizedSaleItems = saleData.items;
        await firestoreService.runTransaction(async transaction => {
          const existingSale = await transaction.get(saleRef);
          if (existingSale.exists()) {
            finalizedSaleItems = ((existingSale.data() as Sale).items || saleData.items);
            return;
          }

          const productSnapshots = new Map<string, any>();
          const batchSnapshotsByProduct = new Map<string, Array<{ id: string; ref: any; data: any }>>();

          // Complete every read before the first write. All candidate batches are read so
          // a transaction retry can re-run FEFO against the latest quantities.
          for (const productId of uniqueProductIds) {
            const productRef = doc(db, 'products', productId);
            productSnapshots.set(productId, await transaction.get(productRef));
            const rows: Array<{ id: string; ref: any; data: any }> = [];
            for (const batchRef of batchRefsByProduct.get(productId) || []) {
              const snapshot = await transaction.get(batchRef.ref);
              if (snapshot.exists()) rows.push({ id: batchRef.id, ref: batchRef.ref, data: snapshot.data() });
            }
            batchSnapshotsByProduct.set(productId, rows);
          }

          const allocationsByProduct = new Map<string, Array<{ batchId: string; batchNumber: string; expiryDate?: string; baseQuantity: number; costPerBaseUnit: number }>>();
          const productDeductions = new Map<string, number>();

          for (const productId of uniqueProductIds) {
            const product = productMap.get(productId)!;
            const multiplier = getBaseUnitMultiplier(product);
            const requestedBaseUnits = stockItems
              .filter(item => item.productId === productId)
              .reduce((sum, item) => sum + Number(item.quantity || 0) * multiplier, 0);
            productDeductions.set(productId, requestedBaseUnits);

            const candidates = (batchSnapshotsByProduct.get(productId) || [])
              .filter(row => row.data.tenantId === profile.tenantId && row.data.branchId === activeBranchId)
              .filter(row => String(row.data.batch_status || '').toLowerCase() === 'active')
              .filter(row => isInventoryBatchUnexpired(row.data.expiryDate))
              .filter(row => Number(row.data.quantity || 0) > 0)
              .sort((a, b) => new Date(a.data.expiryDate || '9999-12-31').getTime() - new Date(b.data.expiryDate || '9999-12-31').getTime());

            let remaining = requestedBaseUnits;
            const allocations: Array<{ batchId: string; batchNumber: string; expiryDate?: string; baseQuantity: number; costPerBaseUnit: number }> = [];
            for (const candidate of candidates) {
              if (remaining <= 0) break;
              const available = Math.max(0, Number(candidate.data.quantity || 0));
              const take = Math.min(remaining, available);
              if (take <= 0) continue;
              allocations.push({
                batchId: candidate.id,
                batchNumber: String(candidate.data.batchNumber || 'UNSPECIFIED'),
                expiryDate: candidate.data.expiryDate,
                baseQuantity: take,
                costPerBaseUnit: Number(candidate.data.purchasePrice || 0)
              });
              remaining -= take;
            }

            if (remaining > 0) {
              throw new Error(`Insufficient unexpired FEFO stock for ${product.name}. Missing ${remaining} base units.`);
            }

            const actualCost = allocations.reduce((sum, allocation) => sum + allocation.baseQuantity * allocation.costPerBaseUnit, 0);
            const productGrossRevenue = stockItems.filter(item => item.productId === productId).reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
            const productNetRevenue = productGrossRevenue * (1 - (discountPercentage / 100));
            if (productNetRevenue + 0.0001 < actualCost) {
              throw new Error(`Checkout blocked after FEFO reallocation: ${product.name} would sell below the actual allocated batch cost. Minimum UGX ${Math.ceil(actualCost).toLocaleString()}, net line revenue UGX ${Math.floor(productNetRevenue).toLocaleString()}.`);
            }
            allocationsByProduct.set(productId, allocations);
          }

          // Apply FEFO batch deductions.
          for (const [productId, allocations] of allocationsByProduct) {
            const rows = batchSnapshotsByProduct.get(productId) || [];
            for (const allocation of allocations) {
              const row = rows.find(candidate => candidate.id === allocation.batchId);
              if (!row) throw new Error(`Allocated batch ${allocation.batchNumber} disappeared during checkout.`);
              const available = Number(row.data.quantity || 0);
              transaction.update(row.ref, { quantity: available - allocation.baseQuantity, updatedAt: serverTimestamp() });
            }
          }

          // Keep product aggregate stock synchronized with base-unit batch deductions.
          for (const [productId, deduction] of productDeductions) {
            const snapshot = productSnapshots.get(productId);
            const product = productMap.get(productId)!;
            if (!snapshot?.exists()) throw new Error(`Product ${product.name} no longer exists.`);
            if (snapshot.data().tenantId !== profile.tenantId) throw new Error(`Product tenant mismatch for ${product.name}.`);
            const currentStock = Number(snapshot.data().stock || 0);
            if (deduction > currentStock) {
              throw new Error(`Inventory aggregate mismatch for ${product.name}. Product stock has ${currentStock} base units but FEFO requires ${deduction}. Reconcile inventory before retrying.`);
            }
            transaction.update(doc(db, 'products', productId), { stock: currentStock - deduction, updatedAt: serverTimestamp() });
          }

          finalizedSaleItems = saleData.items.map(item => {
            if (item.isService) return item;
            const allocations = allocationsByProduct.get(item.productId) || [];
            return {
              ...item,
              batchId: allocations.length === 1 ? allocations[0].batchId : item.batchId,
              batchNumber: allocations.length === 1 ? allocations[0].batchNumber : (allocations.length > 1 ? 'FEFO-MULTI' : item.batchNumber),
              expiryDate: allocations.length === 1 ? allocations[0].expiryDate : (allocations.length > 1 ? 'Multiple' : item.expiryDate),
              batchAllocations: allocations
            };
          });

          const cleanSaleData = JSON.parse(JSON.stringify({ ...saleData, items: finalizedSaleItems }));
          transaction.set(saleRef, {
            ...cleanSaleData,
            inventoryPosted: true,
            inventoryPostedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        }, 'sales/product_batches/products');""",
    'atomic checkout-time FEFO reallocation',
    re.M
)

replace_literal(
    sales_path,
    "        completedSale = saleData;\n        stockPostedAtomically = true;",
    "        completedSale = { ...saleData, items: finalizedSaleItems };\n        stockPostedAtomically = true;",
    'receipt uses final FEFO allocations'
)

# Avoid stale/expired stock in direct receipt-add UI too.
replace_literal(
    sales_path,
    "    const productBatches = batches.filter(b => b.productId === product.id && b.quantity > 0 && b.batch_status === 'active');",
    "    const productBatches = batches.filter(b => b.productId === product.id && b.quantity > 0 && b.batch_status === 'active' && isInventoryBatchUnexpired(b.expiryDate));",
    'ledger edit expiry filter'
)

print('Batch 3 patch complete')
