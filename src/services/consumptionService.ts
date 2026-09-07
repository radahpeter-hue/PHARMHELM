import { 
  collection, 
  doc, 
  getDocs, 
  query, 
  where, 
  serverTimestamp, 
  Timestamp,
  runTransaction,
  getDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import { Product, ProductBatch, InventoryMovementEvent, BranchConsumptionDaily, Sale, SaleItem } from '../types';

/**
 * Utility to determine quantity multiplier to convert commercial units (packs, strips)
 * to the base inventory units (e.g. tablets, capsules, ml).
 */
export function isInventoryBatchUnexpired(expiryDate?: string, now: Date = new Date()): boolean {
  if (!expiryDate) return true;
  const raw = String(expiryDate).trim();
  if (!raw) return true;

  // Regulatory stock records frequently store YYYY-MM-DD or YYYY-MM.
  // A dated batch remains usable through the end of its recorded expiry day,
  // while month-only expiry remains usable through the final day of the month.
  let expiry: Date;
  if (/^\d{4}-\d{2}$/.test(raw)) {
    const [year, month] = raw.split('-').map(Number);
    expiry = new Date(year, month, 0, 23, 59, 59, 999);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number);
    expiry = new Date(year, month - 1, day, 23, 59, 59, 999);
  } else {
    expiry = new Date(raw);
    if (Number.isNaN(expiry.getTime())) return false;
  }
  return expiry.getTime() >= now.getTime();
}

export function getBaseUnitMultiplier(product: Product): number {
  if (!product) return 1;
  const unit = (product.unitOfSell || product.unit || '').toLowerCase();
  if (unit === 'pack') {
    return product.unitsPerPack || 1;
  }
  if (unit === 'strip') {
    return product.unitsPerStrip || 1;
  }
  return 1;
}

/**
 * Utility to format Date key as YYYY-MM-DD in the given timezone (defaults to Africa/Kampala).
 */
export function getDateKeyForTimezone(date: Date, timezone: string = 'Africa/Kampala'): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    return `${year}-${month}-${day}`;
  } catch (error) {
    const utcYear = date.getUTCFullYear();
    const utcMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
    const utcDay = String(date.getUTCDate()).padStart(2, '0');
    return `${utcYear}-${utcMonth}-${utcDay}`;
  }
}

/**
 * Fetches batch document references for a product at a branch before transaction.
 */
export async function getBranchProductBatchRefs(tenantId: string, branchId: string, productId: string) {
  const colRef = collection(db, 'product_batches');
  const q = query(
    colRef,
    where('tenantId', '==', tenantId),
    where('branchId', '==', branchId),
    where('productId', '==', productId)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ ref: doc(db, 'product_batches', d.id), id: d.id }));
}

/**
 * Transactional write hook to record a movement event and incrementally update daily aggregates.
 * Must be executed within runTransaction().
 */
export async function logMovementAndAggregateInTx(
  transaction: any, // Firestore Transaction instance
  batchRefs: { ref: any; id: string }[], // Pre-fetched batch references for reads
  eventData: {
    tenantId: string;
    branchId: string;
    productId: string;
    eventType: InventoryMovementEvent['eventType'];
    quantityDeltaBaseUnits: number;
    consumptionDeltaBaseUnits: number;
    isExceptional: boolean;
    exceptionalReason: string | null;
    sourceCollection: string;
    sourceDocumentId: string;
    sourceLineId: string | null;
    reversalOfEventId: string | null;
    createdBy: string;
    effectiveAt: Date;
    stockAlreadyApplied?: boolean;
    timezone?: string;
  }
) {
  const {
    tenantId,
    branchId,
    productId,
    eventType,
    quantityDeltaBaseUnits,
    consumptionDeltaBaseUnits,
    isExceptional,
    exceptionalReason,
    sourceCollection,
    sourceDocumentId,
    sourceLineId,
    reversalOfEventId,
    createdBy,
    effectiveAt,
    stockAlreadyApplied = false,
    timezone = 'Africa/Kampala'
  } = eventData;

  const dateKey = getDateKeyForTimezone(effectiveAt, timezone);

  // Deterministic stable event ID
  const eventId = reversalOfEventId 
    ? `${sourceCollection}_${sourceDocumentId}_${productId}_reversal_${sourceLineId || 'line'}`
    : `${sourceCollection}_${sourceDocumentId}_${productId}_${sourceLineId || 'line'}`;

  // 1. Check idempotency
  const eventRef = doc(db, 'inventoryMovementEvents', eventId);
  const eventSnap = await transaction.get(eventRef);
  if (eventSnap.exists()) {
    console.log(`[Idempotency] Event ${eventId} already processed, skipping.`);
    return;
  }

  // 2. Fetch Product metadata for base unit info
  const productRef = doc(db, 'products', productId);
  const productSnap = await transaction.get(productRef);
  const productData = productSnap.exists() ? (productSnap.data() as Product) : null;
  const baseUnitName = productData?.baseUnit || productData?.unit || 'unit';

  // 3. Fetch batches in the transaction to compute exact usable stock before changes
  let currentUsableStock = 0;
  
  for (const bRef of batchRefs) {
    const bSnap = await transaction.get(bRef.ref);
    if (bSnap.exists()) {
      const batch = bSnap.data() as ProductBatch;
      const isUnexpired = isInventoryBatchUnexpired(batch.expiryDate);
      const isActive = batch.batch_status === 'active';
      if (isActive && isUnexpired) {
        currentUsableStock += batch.quantity || 0;
      }
    }
  }

  const openingUsableStock = stockAlreadyApplied
    ? currentUsableStock - quantityDeltaBaseUnits
    : currentUsableStock;
  const closingUsableStock = stockAlreadyApplied
    ? currentUsableStock
    : currentUsableStock + quantityDeltaBaseUnits;

  // 4. Load or initialize daily summary
  const summaryId = `${tenantId}_${branchId}_${productId}_${dateKey}`;
  const summaryRef = doc(db, 'branchConsumptionDaily', summaryId);
  const summarySnap = await transaction.get(summaryRef);

  let summary: BranchConsumptionDaily;

  if (summarySnap.exists()) {
    summary = summarySnap.data() as BranchConsumptionDaily;
    summary.closingUsableStock = closingUsableStock;
    summary.updatedAt = serverTimestamp();
    summary.aggregationVersion += 1;
    summary.transactionCount += 1;
  } else {
    summary = {
      tenantId,
      branchId,
      productId,
      dateKey,
      baseUnitId: productId,
      baseUnitName,
      openingUsableStock,
      closingUsableStock,
      ordinaryUnitsSold: 0,
      ordinaryUnitsDispensed: 0,
      unitsReturnedToStock: 0,
      unitsTransferredIn: 0,
      unitsTransferredOut: 0,
      unitsWrittenOff: 0,
      positiveAdjustments: 0,
      negativeAdjustments: 0,
      exceptionalUnits: 0,
      validConsumptionUnits: 0,
      transactionCount: 1,
      consumptionTransactionCount: 0,
      operatingMinutes: null,
      inStockMinutes: null,
      stockoutMinutes: null,
      wasStockedAllDay: currentUsableStock > 0,
      firstStockoutAt: currentUsableStock === 0 ? Timestamp.fromDate(effectiveAt) : null,
      lastRestockedAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      aggregationVersion: 1
    };
  }

  // 5. Apply event stats to aggregates
  if (eventType === 'SALE' || eventType === 'DISPENSING') {
    if (isExceptional) {
      summary.exceptionalUnits = (summary.exceptionalUnits || 0) + consumptionDeltaBaseUnits;
    } else {
      if (eventType === 'SALE') {
        summary.ordinaryUnitsSold += consumptionDeltaBaseUnits;
      } else {
        summary.ordinaryUnitsDispensed += consumptionDeltaBaseUnits;
      }
      summary.validConsumptionUnits += consumptionDeltaBaseUnits;
      summary.consumptionTransactionCount += 1;
    }
  } else if (eventType === 'SALE_REVERSAL' || eventType === 'RETURN_TO_STOCK') {
    if (isExceptional) {
      summary.exceptionalUnits = Math.max(0, (summary.exceptionalUnits || 0) + consumptionDeltaBaseUnits); // consumptionDeltaBaseUnits is negative
    } else {
      summary.validConsumptionUnits = Math.max(0, summary.validConsumptionUnits + consumptionDeltaBaseUnits); // consumptionDeltaBaseUnits is negative
      if (eventType === 'RETURN_TO_STOCK' || eventType === 'SALE_REVERSAL') {
        summary.unitsReturnedToStock += quantityDeltaBaseUnits; // quantityDeltaBaseUnits is positive
      }
      summary.consumptionTransactionCount += 1;
    }
  } else if (eventType === 'TRANSFER_IN') {
    summary.unitsTransferredIn += quantityDeltaBaseUnits;
  } else if (eventType === 'TRANSFER_OUT') {
    summary.unitsTransferredOut += Math.abs(quantityDeltaBaseUnits);
  } else if (eventType === 'WRITE_OFF' || eventType === 'EXPIRY' || eventType === 'DAMAGE') {
    summary.unitsWrittenOff += Math.abs(quantityDeltaBaseUnits);
  } else if (eventType === 'POSITIVE_ADJUSTMENT') {
    summary.positiveAdjustments += quantityDeltaBaseUnits;
  } else if (eventType === 'NEGATIVE_ADJUSTMENT') {
    summary.negativeAdjustments += Math.abs(quantityDeltaBaseUnits);
  }

  // 6. Stockout tracking status updates
  if (closingUsableStock === 0 && currentUsableStock > 0) {
    if (!summary.firstStockoutAt) {
      summary.firstStockoutAt = Timestamp.fromDate(effectiveAt);
    }
    summary.wasStockedAllDay = false;
  } else if (closingUsableStock > 0 && currentUsableStock === 0) {
    summary.lastRestockedAt = Timestamp.fromDate(effectiveAt);
  }

  // 7. Write records to Firestore
  const newEvent: InventoryMovementEvent = {
    tenantId,
    branchId,
    productId,
    eventId,
    eventType,
    quantityDeltaBaseUnits,
    consumptionDeltaBaseUnits,
    isExceptional,
    exceptionalReason,
    sourceCollection,
    sourceDocumentId,
    sourceLineId,
    reversalOfEventId,
    effectiveAt: Timestamp.fromDate(effectiveAt),
    dateKey,
    createdBy,
    createdAt: serverTimestamp()
  };

  transaction.set(eventRef, newEvent);
  transaction.set(summaryRef, summary);
}

/**
 * Logs sale movement events (SALE or SALE_REVERSAL) and updates branchConsumptionDaily summaries.
 */
export async function logSaleMovements(
  saleId: string,
  saleData: Sale,
  isReversal: boolean,
  reversalOfEventId: string | null = null,
  createdBy: string = 'system',
  stockAlreadyApplied: boolean = false
) {
  const itemsByProduct = new Map<string, SaleItem>();
  for (const item of saleData.items.filter(item => !item.isService)) {
    const existing = itemsByProduct.get(item.productId);
    itemsByProduct.set(item.productId, existing
      ? { ...existing, quantity: existing.quantity + item.quantity }
      : { ...item });
  }
  const items = Array.from(itemsByProduct.values());
  if (items.length === 0) return;

  // Use one idempotent transaction per line. This avoids Firestore's prohibition
  // on reading a second product after the first line has already written events.
  for (const item of items) {
    const batchRefs = await getBranchProductBatchRefs(
      saleData.tenantId,
      saleData.branchId,
      item.productId
    );

    await runTransaction(db, async (transaction) => {
      const qty = item.quantity;
      
      const productRef = doc(db, 'products', item.productId);
      const productSnap = await transaction.get(productRef);
      const product = productSnap.exists() ? (productSnap.data() as Product) : null;
      const multiplier = product ? getBaseUnitMultiplier(product) : 1;
      const baseUnits = qty * multiplier;

      const qtyDelta = isReversal ? baseUnits : -baseUnits;
      const consumptionDelta = isReversal ? -baseUnits : baseUnits;
      const eventType = isReversal ? 'SALE_REVERSAL' : 'SALE';

      await logMovementAndAggregateInTx(transaction, batchRefs, {
        tenantId: saleData.tenantId,
        branchId: saleData.branchId,
        productId: item.productId,
        eventType,
        quantityDeltaBaseUnits: qtyDelta,
        consumptionDeltaBaseUnits: consumptionDelta,
        isExceptional: !!saleData.isExceptionalConsumption,
        exceptionalReason: saleData.isExceptionalConsumption ? (saleData.exceptionalConsumptionReason || 'Exceptional sale') : null,
        sourceCollection: 'sales',
        sourceDocumentId: saleId,
        sourceLineId: item.productId,
        reversalOfEventId,
        createdBy,
        effectiveAt: new Date(saleData.timestamp),
        stockAlreadyApplied,
        timezone: 'Africa/Kampala'
      });
    });
  }
}


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
