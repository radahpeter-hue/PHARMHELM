import type { Product, SaleItem } from '../types';

export interface HistoricalBatchAllocation {
  batchId: string;
  batchNumber: string;
  expiryDate?: string;
  baseQuantity: number;
  costPerBaseUnit: number;
}

const positiveNumber = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

export function createSaleLineId(prefix = 'sale-line'): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return `${prefix}:${cryptoApi.randomUUID()}`;
  }
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

export function getStoredCommercialQuantity(item: SaleItem): number {
  const quantity = Number(item.commercialQuantity ?? item.quantity ?? 0);
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Sale item commercial quantity is invalid.');
  return quantity;
}

export function getStoredBaseQuantity(item: SaleItem, product?: Product): number {
  const explicitBaseQuantity = Number(item.baseQuantity);
  if (Number.isFinite(explicitBaseQuantity) && explicitBaseQuantity >= 0) return explicitBaseQuantity;

  const commercialQuantity = getStoredCommercialQuantity(item);
  const storedMultiplier = positiveNumber(item.tierMultiplier);
  if (storedMultiplier !== null) return commercialQuantity * storedMultiplier;

  if (product) {
    const unit = String(product.unitOfSell || product.unit || '').trim().toLowerCase();
    const multiplier = unit === 'pack'
      ? positiveNumber(product.unitsPerPack) || 1
      : unit === 'strip'
        ? positiveNumber(product.unitsPerStrip) || 1
        : 1;
    return commercialQuantity * multiplier;
  }

  return commercialQuantity;
}

export function normaliseStoredAllocations(item: SaleItem, product?: Product): HistoricalBatchAllocation[] {
  if (item.isService) return [];
  const allocations = (item.batchAllocations || [])
    .map(allocation => ({
      batchId: String(allocation.batchId || '').trim(),
      batchNumber: String(allocation.batchNumber || '').trim() || 'UNSPECIFIED',
      expiryDate: allocation.expiryDate,
      baseQuantity: Number(allocation.baseQuantity || 0),
      costPerBaseUnit: Math.max(0, Number(allocation.costPerBaseUnit || 0))
    }))
    .filter(allocation => allocation.batchId && Number.isFinite(allocation.baseQuantity) && allocation.baseQuantity > 0);

  if (allocations.length > 0) return allocations;

  const batchId = String(item.batchId || '').trim();
  const batchNumber = String(item.batchNumber || '').trim();
  if (!batchId || !batchNumber || batchNumber === 'FEFO-MULTI' || batchNumber === 'FEFO-PENDING') return [];

  const baseQuantity = getStoredBaseQuantity(item, product);
  if (baseQuantity <= 0) return [];
  const actualLineCost = Math.max(0, Number(item.actualLineCost ?? 0));
  return [{
    batchId,
    batchNumber,
    expiryDate: item.expiryDate,
    baseQuantity,
    costPerBaseUnit: actualLineCost > 0 ? actualLineCost / baseQuantity : 0
  }];
}

export function assertExactStoredAllocations(item: SaleItem, product?: Product): HistoricalBatchAllocation[] {
  const allocations = normaliseStoredAllocations(item, product);
  const expected = getStoredBaseQuantity(item, product);
  const allocated = allocations.reduce((sum, allocation) => sum + allocation.baseQuantity, 0);

  const commercialQuantity = Number(item.commercialQuantity ?? item.quantity ?? 0);
  const multiplier = positiveNumber(item.tierMultiplier);
  const explicitBaseQuantity = Number(item.baseQuantity);
  if (
    multiplier !== null &&
    Number.isFinite(commercialQuantity) &&
    commercialQuantity >= 0 &&
    Number.isFinite(explicitBaseQuantity) &&
    explicitBaseQuantity >= 0 &&
    Math.abs(explicitBaseQuantity - commercialQuantity * multiplier) > 0.0001
  ) {
    throw new Error(`${item.productName || item.name || item.productId} stored base quantity is inconsistent with its historical commercial quantity and multiplier.`);
  }

  if (expected > 0 && allocations.length === 0) {
    throw new Error(`${item.productName || item.name || item.productId} does not contain exact historical batch allocations.`);
  }
  if (Math.abs(allocated - expected) > 0.0001) {
    throw new Error(`${item.productName || item.name || item.productId} historical batch allocations do not match its stored base quantity.`);
  }
  return allocations;
}

export function trimAllocationsToBaseQuantity(
  allocations: HistoricalBatchAllocation[],
  targetBaseQuantity: number
): HistoricalBatchAllocation[] {
  if (!Number.isFinite(targetBaseQuantity) || targetBaseQuantity < 0) throw new Error('Target base quantity is invalid.');
  let remaining = targetBaseQuantity;
  const result: HistoricalBatchAllocation[] = [];
  for (const allocation of allocations) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, allocation.baseQuantity);
    if (take > 0) result.push({ ...allocation, baseQuantity: take });
    remaining -= take;
  }
  if (remaining > 0.0001) throw new Error('Stored allocations are smaller than the requested preserved quantity.');
  return result;
}

export function allocationCost(allocations: HistoricalBatchAllocation[]): number {
  return allocations.reduce((sum, allocation) => sum + allocation.baseQuantity * allocation.costPerBaseUnit, 0);
}

export function buildHistoricalSaleItem(params: {
  item: SaleItem;
  allocations: HistoricalBatchAllocation[];
  commercialQuantity?: number;
  baseQuantity?: number;
}): SaleItem {
  const { item, allocations } = params;
  const commercialQuantity = params.commercialQuantity ?? getStoredCommercialQuantity(item);
  const baseQuantity = params.baseQuantity ?? allocations.reduce((sum, allocation) => sum + allocation.baseQuantity, 0);
  const actualLineCost = allocationCost(allocations);
  const unitPrice = Number(item.actualUnitPrice ?? item.unitPrice ?? 0);
  const lineTotal = commercialQuantity * unitPrice;
  const single = allocations.length === 1 ? allocations[0] : null;
  return {
    ...item,
    lineId: item.lineId || createSaleLineId(),
    quantity: commercialQuantity,
    commercialQuantity,
    baseQuantity,
    batchId: single?.batchId || '',
    batchNumber: single?.batchNumber || (allocations.length > 1 ? 'FEFO-MULTI' : 'N/A'),
    expiryDate: single?.expiryDate || (allocations.length > 1 ? 'Multiple' : item.expiryDate),
    batchAllocations: allocations,
    actualLineCost,
    costPrice: commercialQuantity > 0 ? actualLineCost / commercialQuantity : actualLineCost,
    subtotal: lineTotal,
    total: lineTotal,
    lineTotal
  } as SaleItem;
}

export function describeSaleItemQuantity(item: SaleItem, baseUnit?: string): {
  commercialText: string;
  baseText?: string;
} {
  const commercialQuantity = getStoredCommercialQuantity(item);
  const label = item.tierLabel || (item.tierCode === 'strip' ? 'Strip' : item.tierCode === 'pack' ? 'Pack' : item.tierCode === 'unit' ? 'Unit' : '');
  const commercialText = label
    ? `${commercialQuantity} ${commercialQuantity === 1 ? label : `${label}s`}`
    : String(commercialQuantity);
  const baseQuantity = Number(item.baseQuantity);
  const baseLabel = String(baseUnit || item.dosageFormSnapshot || 'base units').trim() || 'base units';
  return {
    commercialText,
    baseText: Number.isFinite(baseQuantity) && baseQuantity >= 0 && label
      ? `${baseQuantity} ${baseLabel}`
      : undefined
  };
}

export function saleItemFingerprint(items: SaleItem[]): string {
  return JSON.stringify(items.map((item, index) => ({
    index,
    lineId: item.lineId || null,
    productId: item.productId,
    tierCode: item.tierCode || null,
    tierMultiplier: Number(item.tierMultiplier || 0),
    commercialQuantity: Number(item.commercialQuantity ?? item.quantity ?? 0),
    baseQuantity: Number(item.baseQuantity ?? 0),
    configuredPrice: Number(item.configuredPrice ?? 0),
    actualUnitPrice: Number(item.actualUnitPrice ?? item.unitPrice ?? 0),
    priceSource: item.priceSource || null,
    discountStatus: item.discountStatus || null,
    taxStatus: item.taxStatus || null,
    isService: Boolean(item.isService),
    allocations: normaliseStoredAllocations(item).map(allocation => ({
      batchId: allocation.batchId,
      batchNumber: allocation.batchNumber,
      baseQuantity: allocation.baseQuantity,
      costPerBaseUnit: allocation.costPerBaseUnit
    }))
  })));
}
