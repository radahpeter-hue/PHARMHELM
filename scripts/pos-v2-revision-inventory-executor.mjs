import {
  INVENTORY_REVERSAL_EVENT_TYPE,
  assertLiveBatchMatchesRestore,
  assertLiveProductCanRestore,
  buildRevisionInventoryRestores,
  reverseConsumptionSummary
} from './pos-v2-revision-inventory-core.mjs';
import {
  consumptionSummaryId,
  movementEventId
} from './pos-v2-batch4-core.mjs';

const EPSILON = 0.0001;

function clean(value) {
  return String(value ?? '').trim();
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildInventoryReversalEvent({ sale, restore, originalEvent, revisionId, workerId, serverTimestamp }) {
  if (!sale || !restore || !originalEvent) throw new Error('Inventory reversal event inputs are incomplete.');
  if (!clean(revisionId)) throw new Error('Inventory reversal event requires a revisionId.');
  if (!clean(workerId)) throw new Error('Inventory reversal event requires a worker identity.');
  return {
    tenantId: sale.tenantId,
    branchId: sale.branchId,
    productId: restore.productId,
    eventId: restore.eventId,
    eventType: INVENTORY_REVERSAL_EVENT_TYPE,
    quantityDeltaBaseUnits: restore.baseQuantity,
    consumptionDeltaBaseUnits: -restore.baseQuantity,
    isExceptional: Boolean(originalEvent.isExceptional),
    exceptionalReason: originalEvent.exceptionalReason || null,
    sourceCollection: 'sales',
    sourceDocumentId: sale.id,
    sourceLineId: restore.productId,
    reversalOfEventId: originalEvent.eventId,
    revisionId: clean(revisionId),
    receiptNumber: sale.receiptNumber || null,
    effectiveAt: serverTimestamp,
    dateKey: originalEvent.dateKey,
    createdBy: workerId,
    createdAt: serverTimestamp
  };
}

export async function executeInventoryAndConsumptionReversal({ db, sale, revisionId, workerId, FieldValue }) {
  if (!db || typeof db.runTransaction !== 'function') throw new Error('Inventory reversal requires a Firestore database.');
  if (!FieldValue || typeof FieldValue.serverTimestamp !== 'function') throw new Error('Inventory reversal requires server timestamps.');

  const plan = buildRevisionInventoryRestores({ sale, revisionId });
  if (plan.products.length === 0) {
    return { replayed: false, productCount: 0, batchCount: 0, totalBaseUnits: 0 };
  }

  return db.runTransaction(async tx => {
    const reversalEventRefs = plan.products.map(row => db.collection('inventoryMovementEvents').doc(row.eventId));
    const reversalEventSnaps = [];
    for (const ref of reversalEventRefs) reversalEventSnaps.push(await tx.get(ref));

    const existingCount = reversalEventSnaps.filter(snap => snap.exists).length;
    if (existingCount === reversalEventSnaps.length) {
      for (const snap of reversalEventSnaps) {
        const event = snap.data();
        if (event.eventType !== INVENTORY_REVERSAL_EVENT_TYPE
          || event.revisionId !== revisionId
          || event.sourceDocumentId !== sale.id) {
          throw new Error('Inventory reversal event identity conflict. Manual review required.');
        }
      }
      return {
        replayed: true,
        productCount: plan.products.length,
        batchCount: plan.batches.length,
        totalBaseUnits: plan.totalBaseUnits
      };
    }
    if (existingCount > 0) throw new Error('Partial inventory reversal detected. Manual review required.');

    const originalEvents = new Map();
    const summaries = new Map();
    for (const product of plan.products) {
      const originalEventId = movementEventId({ saleId: sale.id, productId: product.productId });
      const originalEventRef = db.collection('inventoryMovementEvents').doc(originalEventId);
      const originalEventSnap = await tx.get(originalEventRef);
      if (!originalEventSnap.exists) throw new Error(`Original consumption event ${originalEventId} is missing.`);
      const originalEvent = originalEventSnap.data();
      if (originalEvent.eventType !== 'SALE'
        || originalEvent.sourceDocumentId !== sale.id
        || originalEvent.productId !== product.productId) {
        throw new Error(`Original consumption event ${originalEventId} does not match the canonical sale.`);
      }
      const consumed = numberValue(originalEvent.consumptionDeltaBaseUnits, NaN);
      if (!Number.isFinite(consumed) || Math.abs(consumed - product.baseQuantity) > EPSILON) {
        throw new Error(`Original consumption quantity does not reconcile for ${product.productId}.`);
      }
      originalEvents.set(product.productId, { id: originalEventId, data: originalEvent });

      const summaryId = consumptionSummaryId(sale.tenantId, sale.branchId, product.productId, originalEvent.dateKey);
      const summaryRef = db.collection('branchConsumptionDaily').doc(summaryId);
      const summarySnap = await tx.get(summaryRef);
      if (!summarySnap.exists) throw new Error(`Consumption summary ${summaryId} is missing.`);
      summaries.set(product.productId, { ref: summaryRef, data: summarySnap.data() });
    }

    const batchRows = [];
    for (const restore of plan.batches) {
      const ref = db.collection('product_batches').doc(restore.batchId);
      const snap = await tx.get(ref);
      const batch = snap.exists ? snap.data() : null;
      assertLiveBatchMatchesRestore({ batch, restore, tenantId: sale.tenantId, branchId: sale.branchId });
      batchRows.push({ ref, batch, restore });
    }

    const productRows = [];
    for (const restore of plan.products) {
      const ref = db.collection('products').doc(restore.productId);
      const snap = await tx.get(ref);
      const product = snap.exists ? snap.data() : null;
      assertLiveProductCanRestore({ product, restore, tenantId: sale.tenantId });
      productRows.push({ ref, product, restore });
    }

    for (const { ref, batch, restore } of batchRows) {
      tx.update(ref, {
        quantity: numberValue(batch.quantity) + restore.baseQuantity,
        lastUpdated: new Date().toISOString()
      });
    }

    for (const { ref, product, restore } of productRows) {
      const current = numberValue(product.stock ?? product.quantityInStock);
      const nextStock = current + restore.baseQuantity;
      tx.update(ref, {
        stock: nextStock,
        quantityInStock: nextStock,
        stockAggregateSource: 'product_batches',
        updatedAt: FieldValue.serverTimestamp()
      });

      const original = originalEvents.get(restore.productId);
      const summaryEntry = summaries.get(restore.productId);
      const summary = reverseConsumptionSummary({
        summary: summaryEntry.data,
        baseQuantity: restore.baseQuantity,
        exceptional: Boolean(original.data.isExceptional),
        productId: restore.productId
      });
      summary.updatedAt = FieldValue.serverTimestamp();
      tx.set(summaryEntry.ref, summary);

      const timestamp = FieldValue.serverTimestamp();
      const reversalEvent = buildInventoryReversalEvent({
        sale,
        restore,
        originalEvent: { ...original.data, eventId: original.id },
        revisionId,
        workerId,
        serverTimestamp: timestamp
      });
      tx.create(db.collection('inventoryMovementEvents').doc(restore.eventId), reversalEvent);
    }

    return {
      replayed: false,
      productCount: plan.products.length,
      batchCount: plan.batches.length,
      totalBaseUnits: plan.totalBaseUnits
    };
  });
}