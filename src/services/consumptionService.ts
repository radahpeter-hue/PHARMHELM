import { 
  collection, 
  doc, 
  getDocs, 
  query, 
  where, 
  serverTimestamp, 
  Timestamp,
  runTransaction
} from 'firebase/firestore';
import { db } from '../firebase';
import { Product, ProductBatch, InventoryMovementEvent, BranchConsumptionDaily, Sale, SaleItem } from '../types';

/**
 * Utility to determine quantity multiplier to convert commercial units (packs, strips)
 * to the base inventory units (e.g. tablets, capsules, ml).
 */
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
      const isUnexpired = batch.expiryDate ? new Date(batch.expiryDate) > new Date() : true;
      const isActive = batch.batch_status === 'active';
      if (isActive && isUnexpired) {
        currentUsableStock += batch.quantity || 0;
      }
    }
  }

  const closingUsableStock = currentUsableStock + quantityDeltaBaseUnits;

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
      openingUsableStock: currentUsableStock,
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
  createdBy: string = 'system'
) {
  const items = saleData.items.filter(item => !item.isService);
  if (items.length === 0) return;

  // Pre-fetch batch refs outside transaction (Firestore requirement for Web SDK queries)
  const itemsBatchRefs: Record<string, { ref: any; id: string }[]> = {};
  for (const item of items) {
    itemsBatchRefs[item.productId] = await getBranchProductBatchRefs(
      saleData.tenantId,
      saleData.branchId,
      item.productId
    );
  }

  await runTransaction(db, async (transaction) => {
    for (const item of items) {
      const batchRefs = itemsBatchRefs[item.productId] || [];
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
        timezone: 'Africa/Kampala'
      });
    }
  });
}

