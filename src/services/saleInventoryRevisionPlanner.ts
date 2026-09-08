import type { Product, SaleItem } from '../types';
import {
  allocationCost,
  assertExactStoredAllocations,
  buildHistoricalSaleItem,
  createSaleLineId,
  getStoredBaseQuantity,
  getStoredCommercialQuantity,
  type HistoricalBatchAllocation,
  trimAllocationsToBaseQuantity
} from './saleTierHistoryService';

export interface RevisionBatchState {
  id: string;
  tenantId: string;
  branchId: string;
  productId: string;
  batchNumber: string;
  expiryDate?: string;
  batchStatus?: string;
  quantity: number;
  costPerBaseUnit: number;
}

export interface SaleRevisionPlan {
  finalItems: SaleItem[];
  batchNextQuantities: Map<string, number>;
  productBaseDeltas: Map<string, number>;
}

const isUnexpired = (expiryDate?: string, now = new Date()): boolean => {
  if (!expiryDate) return true;
  const raw = String(expiryDate).trim();
  if (!raw) return true;
  let expiry: Date;
  if (/^\d{4}-\d{2}$/.test(raw)) {
    const [year, month] = raw.split('-').map(Number);
    expiry = new Date(year, month, 0, 23, 59, 59, 999);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number);
    expiry = new Date(year, month - 1, day, 23, 59, 59, 999);
  } else {
    expiry = new Date(raw);
  }
  return !Number.isNaN(expiry.getTime()) && expiry.getTime() >= now.getTime();
};

const isFefoEligible = (batch: RevisionBatchState, now: Date): boolean => {
  const status = String(batch.batchStatus || 'active').toLowerCase();
  return status === 'active' && isUnexpired(batch.expiryDate, now);
};

const getProduct = (products: Map<string, Product>, item: SaleItem): Product => {
  const product = products.get(item.productId);
  if (!product) throw new Error(`Product ${item.productName || item.name || item.productId} no longer exists.`);
  return product;
};

const lineKey = (item: SaleItem, index: number): string => item.lineId || `legacy-line:${index}`;

const sumByProduct = (items: SaleItem[], products: Map<string, Product>): Map<string, number> => {
  const totals = new Map<string, number>();
  for (const item of items) {
    if (item.isService) continue;
    const product = getProduct(products, item);
    const quantity = getStoredBaseQuantity(item, product);
    totals.set(item.productId, (totals.get(item.productId) || 0) + quantity);
  }
  return totals;
};

function reserveAllocation(
  virtualQuantity: Map<string, number>,
  allocation: HistoricalBatchAllocation,
  requiredProductId: string,
  batches: Map<string, RevisionBatchState>
) {
  const batch = batches.get(allocation.batchId);
  if (!batch) throw new Error(`Historical batch ${allocation.batchNumber} no longer exists.`);
  if (batch.productId !== requiredProductId) throw new Error(`Historical batch ${allocation.batchNumber} belongs to a different product.`);
  const available = virtualQuantity.get(batch.id) || 0;
  if (available + 0.0001 < allocation.baseQuantity) {
    throw new Error(`Historical batch ${allocation.batchNumber} does not contain enough stock to preserve this receipt allocation.`);
  }
  virtualQuantity.set(batch.id, available - allocation.baseQuantity);
}

function allocateAdditionalFefo(params: {
  productId: string;
  requiredBaseQuantity: number;
  batches: RevisionBatchState[];
  virtualQuantity: Map<string, number>;
  now: Date;
}): HistoricalBatchAllocation[] {
  const { productId, batches, virtualQuantity, now } = params;
  let remaining = params.requiredBaseQuantity;
  const allocations: HistoricalBatchAllocation[] = [];
  const candidates = batches
    .filter(batch => batch.productId === productId)
    .filter(batch => isFefoEligible(batch, now))
    .sort((a, b) => {
      const expiryDiff = new Date(a.expiryDate || '9999-12-31').getTime() - new Date(b.expiryDate || '9999-12-31').getTime();
      if (expiryDiff !== 0) return expiryDiff;
      return a.id.localeCompare(b.id);
    });

  for (const batch of candidates) {
    if (remaining <= 0) break;
    const available = Math.max(0, virtualQuantity.get(batch.id) || 0);
    if (available <= 0) continue;
    const take = Math.min(remaining, available);
    allocations.push({
      batchId: batch.id,
      batchNumber: batch.batchNumber || 'UNSPECIFIED',
      expiryDate: batch.expiryDate,
      baseQuantity: take,
      costPerBaseUnit: Math.max(0, Number(batch.costPerBaseUnit || 0))
    });
    virtualQuantity.set(batch.id, available - take);
    remaining -= take;
  }

  if (remaining > 0.0001) {
    throw new Error(`Insufficient active unexpired FEFO stock. Missing ${remaining} base units.`);
  }
  return allocations;
}

export function planSaleInventoryRevision(params: {
  originalItems: SaleItem[];
  updatedItems: SaleItem[];
  products: Map<string, Product>;
  batches: RevisionBatchState[];
  tenantId: string;
  branchId: string;
  discountPercentage?: number;
  now?: Date;
}): SaleRevisionPlan {
  const { originalItems, updatedItems, products, tenantId, branchId } = params;
  const now = params.now || new Date();
  const discountFactor = 1 - Math.max(0, Number(params.discountPercentage || 0)) / 100;
  const batchMap = new Map(params.batches.map(batch => [batch.id, batch]));
  const virtualQuantity = new Map<string, number>();

  for (const batch of params.batches) {
    if (batch.tenantId !== tenantId || batch.branchId !== branchId) {
      throw new Error(`Batch ${batch.batchNumber || batch.id} failed tenant or branch validation.`);
    }
    virtualQuantity.set(batch.id, Math.max(0, Number(batch.quantity || 0)));
  }

  const originalByLine = new Map<string, { item: SaleItem; index: number; allocations: HistoricalBatchAllocation[] }>();
  originalItems.forEach((item, index) => {
    if (item.isService) return;
    const product = getProduct(products, item);
    const allocations = assertExactStoredAllocations(item, product);
    const key = lineKey(item, index);
    if (originalByLine.has(key)) throw new Error(`Receipt line identity ${key} is duplicated.`);
    originalByLine.set(key, { item, index, allocations });

    for (const allocation of allocations) {
      const batch = batchMap.get(allocation.batchId);
      if (!batch) throw new Error(`Historical batch ${allocation.batchNumber} no longer exists.`);
      if (batch.productId !== item.productId) throw new Error(`Historical batch ${allocation.batchNumber} belongs to a different product.`);
      virtualQuantity.set(batch.id, (virtualQuantity.get(batch.id) || 0) + allocation.baseQuantity);
    }
  });

  const staged = updatedItems.map((item, index) => {
    if (item.isService) return { item: { ...item, lineId: item.lineId || createSaleLineId('service-line') }, index, preserved: [] as HistoricalBatchAllocation[], extra: 0 };
    const product = getProduct(products, item);
    if (product.tenantId !== tenantId) throw new Error(`Product tenant mismatch for ${product.name}.`);
    const key = lineKey(item, index);
    const original = originalByLine.get(key);
    if (item.lineId && original && original.item.productId !== item.productId) {
      throw new Error('Changing the product identity of an existing receipt line is not allowed. Remove the line and add a new product line instead.');
    }

    const commercialQuantity = getStoredCommercialQuantity(item);
    if (!Number.isInteger(commercialQuantity) || commercialQuantity <= 0) {
      throw new Error(`${item.productName || item.name || product.name} must have a positive whole commercial quantity.`);
    }
    const targetBaseQuantity = getStoredBaseQuantity({ ...item, baseQuantity: undefined } as SaleItem, product);
    if (!Number.isFinite(targetBaseQuantity) || targetBaseQuantity <= 0) throw new Error(`${product.name} has an invalid revised base quantity.`);

    const originalAllocations = original?.allocations || [];
    const originalBaseQuantity = originalAllocations.reduce((sum, allocation) => sum + allocation.baseQuantity, 0);
    const preserveQuantity = Math.min(targetBaseQuantity, originalBaseQuantity);
    const preserved = preserveQuantity > 0 ? trimAllocationsToBaseQuantity(originalAllocations, preserveQuantity) : [];

    return {
      item: { ...item, lineId: item.lineId || createSaleLineId() },
      index,
      product,
      commercialQuantity,
      targetBaseQuantity,
      preserved,
      extra: targetBaseQuantity - preserveQuantity
    };
  });

  for (const stage of staged) {
    if (stage.item.isService) continue;
    for (const allocation of stage.preserved) reserveAllocation(virtualQuantity, allocation, stage.item.productId, batchMap);
  }

  const finalItems: SaleItem[] = [];
  for (const stage of staged) {
    if (stage.item.isService) {
      finalItems.push(stage.item);
      continue;
    }
    const additional = stage.extra > 0
      ? allocateAdditionalFefo({
          productId: stage.item.productId,
          requiredBaseQuantity: stage.extra,
          batches: params.batches,
          virtualQuantity,
          now
        })
      : [];
    const allocations = [...stage.preserved, ...additional];
    const finalItem = buildHistoricalSaleItem({
      item: stage.item,
      allocations,
      commercialQuantity: stage.commercialQuantity,
      baseQuantity: stage.targetBaseQuantity
    });
    const netLineRevenue = Number(finalItem.lineTotal ?? finalItem.total ?? 0) * discountFactor;
    const actualCost = allocationCost(allocations);
    if (netLineRevenue + 0.0001 < actualCost) {
      throw new Error(`Receipt edit blocked: ${finalItem.productName || finalItem.name} would sell below the actual allocated batch cost. Minimum UGX ${Math.ceil(actualCost).toLocaleString()}, net line revenue UGX ${Math.floor(netLineRevenue).toLocaleString()}.`);
    }
    finalItems.push(finalItem);
  }

  const originalTotals = sumByProduct(originalItems, products);
  const updatedTotals = sumByProduct(finalItems, products);
  const productBaseDeltas = new Map<string, number>();
  const productIds = new Set([...originalTotals.keys(), ...updatedTotals.keys()]);
  for (const productId of productIds) {
    productBaseDeltas.set(productId, (updatedTotals.get(productId) || 0) - (originalTotals.get(productId) || 0));
  }

  return {
    finalItems,
    batchNextQuantities: virtualQuantity,
    productBaseDeltas
  };
}
