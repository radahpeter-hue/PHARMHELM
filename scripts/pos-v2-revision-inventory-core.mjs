export const INVENTORY_REVERSAL_EVENT_TYPE = 'SALE_REVERSAL';

const EPSILON = 0.0001;

function clean(value) {
  return String(value ?? '').trim();
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stablePart(value, max = 180) {
  return clean(value).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, max);
}

export function revisionInventoryEventId({ originalSaleId, productId, revisionId }) {
  return `sales_${stablePart(originalSaleId)}_${stablePart(productId)}_revision_${stablePart(revisionId)}`.slice(0, 240);
}

function expectedStoredBaseQuantity(item) {
  const explicit = numberValue(item?.baseQuantity, NaN);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const commercial = numberValue(item?.commercialQuantity ?? item?.quantity, NaN);
  const multiplier = numberValue(item?.tierMultiplier, NaN);
  if (clean(item?.tierCode) && Number.isFinite(commercial) && commercial > 0 && Number.isFinite(multiplier) && multiplier > 0) {
    return commercial * multiplier;
  }

  throw new Error(`Immutable base-unit history is missing for ${item?.productName || item?.name || item?.productId || 'sale item'}.`);
}

export function buildRevisionInventoryRestores({ sale, revisionId }) {
  if (!sale || Number(sale.engineVersion || 0) !== 2 || sale.status !== 'completed') {
    throw new Error('Inventory reversal requires a completed POS V2 sale.');
  }
  if (!clean(revisionId)) throw new Error('Inventory reversal requires a revisionId.');

  const batchMap = new Map();
  const productMap = new Map();

  for (const item of Array.isArray(sale.items) ? sale.items : []) {
    if (item?.isService) continue;
    const productId = clean(item?.productId);
    if (!productId) throw new Error('A stock line is missing its productId.');

    const allocations = Array.isArray(item?.batchAllocations) ? item.batchAllocations : [];
    if (allocations.length === 0) {
      throw new Error(`Exact historical batch allocations are missing for ${item?.productName || item?.name || productId}.`);
    }

    let allocatedBase = 0;
    for (const allocation of allocations) {
      const batchId = clean(allocation?.batchId);
      const batchNumber = clean(allocation?.batchNumber);
      const baseQuantity = numberValue(allocation?.baseQuantity, NaN);
      if (!batchId || !batchNumber || !Number.isFinite(baseQuantity) || baseQuantity <= 0) {
        throw new Error(`A historical allocation is invalid for ${item?.productName || item?.name || productId}.`);
      }

      allocatedBase += baseQuantity;
      const existing = batchMap.get(batchId);
      if (existing && (existing.productId !== productId || existing.batchNumber !== batchNumber)) {
        throw new Error(`Historical batch ${batchId} is linked inconsistently across sale lines.`);
      }
      batchMap.set(batchId, {
        batchId,
        batchNumber,
        productId,
        baseQuantity: numberValue(existing?.baseQuantity) + baseQuantity
      });
    }

    const expectedBase = expectedStoredBaseQuantity(item);
    if (Math.abs(expectedBase - allocatedBase) > EPSILON) {
      throw new Error(`Historical allocation quantity does not reconcile for ${item?.productName || item?.name || productId}.`);
    }

    const currentProduct = productMap.get(productId);
    productMap.set(productId, {
      productId,
      baseQuantity: numberValue(currentProduct?.baseQuantity) + allocatedBase,
      eventId: revisionInventoryEventId({ originalSaleId: sale.id, productId, revisionId })
    });
  }

  const batches = [...batchMap.values()].sort((a, b) => a.batchId.localeCompare(b.batchId));
  const products = [...productMap.values()].sort((a, b) => a.productId.localeCompare(b.productId));
  const totalBaseUnits = products.reduce((sum, row) => sum + row.baseQuantity, 0);

  return {
    tenantId: sale.tenantId,
    branchId: sale.branchId,
    originalSaleId: sale.id,
    originalReceiptNumber: sale.receiptNumber,
    revisionId: clean(revisionId),
    batches,
    products,
    totalBaseUnits
  };
}

export function assertLiveBatchMatchesRestore({ batch, restore, tenantId, branchId }) {
  if (!batch) throw new Error(`Historical batch ${restore?.batchId || ''} no longer exists.`);
  if (batch.tenantId !== tenantId) throw new Error(`Historical batch ${restore.batchId} tenant mismatch.`);
  if (batch.branchId !== branchId) throw new Error(`Historical batch ${restore.batchId} branch mismatch.`);
  if (batch.productId !== restore.productId) throw new Error(`Historical batch ${restore.batchId} product mismatch.`);
  if (clean(batch.batchNumber) !== clean(restore.batchNumber)) throw new Error(`Historical batch ${restore.batchId} number mismatch.`);
  const quantity = numberValue(batch.quantity, NaN);
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error(`Historical batch ${restore.batchId} has invalid live quantity.`);
  return true;
}

export function assertLiveProductCanRestore({ product, restore, tenantId }) {
  if (!product) throw new Error(`Product ${restore?.productId || ''} no longer exists.`);
  if (product.tenantId !== tenantId) throw new Error(`Product ${restore.productId} tenant mismatch.`);
  const stock = numberValue(product.stock ?? product.quantityInStock, NaN);
  if (!Number.isFinite(stock) || stock < 0) throw new Error(`Product ${restore.productId} has invalid live stock.`);
  return true;
}
