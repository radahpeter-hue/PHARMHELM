import type { Product, SaleItem, SystemSettings } from '../types';
import type { SellingTierCode, SellingTierFeatureSettings } from '../types/sellingTier';
import { resolveSellingTiers } from './sellingTierService';

export interface CheckoutBatchAllocation {
  batchId: string;
  batchNumber: string;
  expiryDate?: string;
  baseQuantity: number;
  costPerBaseUnit: number;
}

export interface CheckoutBatchCandidate {
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

export interface CheckoutLineDemand {
  lineIndex: number;
  productId: string;
  commercialQuantity: number;
  baseQuantity: number;
  tierCode?: SellingTierCode;
  tierMultiplier: number;
}

export interface CheckoutLineAllocationResult extends CheckoutLineDemand {
  allocations: CheckoutBatchAllocation[];
  actualLineCost: number;
}

const numberEquals = (left: number, right: number) => Math.abs(left - right) < 0.0001;

const legacyMultiplier = (product: Product): number => {
  const unit = String(product.unitOfSell || product.unit || '').trim().toLowerCase();
  if (unit === 'pack') return Number(product.unitsPerPack || 1);
  if (unit === 'strip') return Number(product.unitsPerStrip || 1);
  return 1;
};

const commercialQuantityForItem = (item: SaleItem): number => {
  const quantity = Number(item.commercialQuantity ?? item.quantity ?? 0);
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
    throw new Error(`${item.productName || item.name || 'Sale item'} must have a positive whole commercial quantity.`);
  }
  return quantity;
};

export function resolveCheckoutLineDemand(params: {
  item: SaleItem;
  lineIndex: number;
  liveProduct: Product;
  settings?: SystemSettings | SellingTierFeatureSettings | null;
  tenantId: string;
  branchId: string;
}): CheckoutLineDemand {
  const { item, lineIndex, liveProduct, settings, tenantId, branchId } = params;
  const commercialQuantity = commercialQuantityForItem(item);

  if (item.tenantId && item.tenantId !== tenantId) {
    throw new Error(`${item.productName || liveProduct.name} has a tenant mismatch in the basket.`);
  }
  if (item.branchId && item.branchId !== branchId) {
    throw new Error(`${item.productName || liveProduct.name} belongs to a different branch basket.`);
  }

  if (!item.tierCode) {
    const multiplier = legacyMultiplier(liveProduct);
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      throw new Error(`${liveProduct.name} has an invalid legacy selling multiplier.`);
    }
    return {
      lineIndex,
      productId: item.productId,
      commercialQuantity,
      baseQuantity: commercialQuantity * multiplier,
      tierMultiplier: multiplier
    };
  }

  const resolution = resolveSellingTiers(liveProduct, settings);
  if (resolution.mode !== 'multi-tier') {
    throw new Error(`${liveProduct.name} multi-tier configuration changed after it was added to the basket. Refresh the product and add it again.`);
  }

  const liveTier = resolution.tiers.find(tier => tier.code === item.tierCode);
  if (!liveTier) {
    throw new Error(`${liveProduct.name} ${item.tierLabel || item.tierCode} tier is no longer enabled. Refresh the product and add it again.`);
  }

  const storedMultiplier = Number(item.tierMultiplier || 0);
  if (!Number.isFinite(storedMultiplier) || storedMultiplier <= 0 || !numberEquals(storedMultiplier, liveTier.multiplier)) {
    throw new Error(`${liveProduct.name} ${liveTier.label} packaging changed after it was added to the basket. Refresh the product and add it again.`);
  }

  const storedConfiguredPrice = Number(item.configuredPrice);
  if (!Number.isFinite(storedConfiguredPrice) || liveTier.configuredPrice === null || !numberEquals(storedConfiguredPrice, liveTier.configuredPrice)) {
    throw new Error(`${liveProduct.name} ${liveTier.label} configured price changed after it was added to the basket. Refresh the product and add it again.`);
  }

  const actualUnitPrice = Number(item.actualUnitPrice ?? item.unitPrice ?? 0);
  if (!Number.isFinite(actualUnitPrice) || actualUnitPrice < 0) {
    throw new Error(`${liveProduct.name} ${liveTier.label} has an invalid selling price.`);
  }

  const expectedBaseQuantity = commercialQuantity * liveTier.multiplier;
  const storedBaseQuantity = Number(item.baseQuantity);
  if (!Number.isFinite(storedBaseQuantity) || !numberEquals(storedBaseQuantity, expectedBaseQuantity)) {
    throw new Error(`${liveProduct.name} ${liveTier.label} basket quantity is inconsistent with its stored base quantity. Refresh the product and add it again.`);
  }

  return {
    lineIndex,
    productId: item.productId,
    commercialQuantity,
    baseQuantity: expectedBaseQuantity,
    tierCode: item.tierCode,
    tierMultiplier: liveTier.multiplier
  };
}

export function buildCheckoutLineDemands(params: {
  items: SaleItem[];
  liveProducts: Map<string, Product>;
  settings?: SystemSettings | SellingTierFeatureSettings | null;
  tenantId: string;
  branchId: string;
}): CheckoutLineDemand[] {
  const { items, liveProducts, settings, tenantId, branchId } = params;
  const demands: CheckoutLineDemand[] = [];

  items.forEach((item, lineIndex) => {
    if (item.isService) return;
    const liveProduct = liveProducts.get(item.productId);
    if (!liveProduct) throw new Error(`Product ${item.productName || item.productId} no longer exists.`);
    if (liveProduct.tenantId !== tenantId) throw new Error(`Product tenant mismatch for ${liveProduct.name}.`);
    demands.push(resolveCheckoutLineDemand({ item, lineIndex, liveProduct, settings, tenantId, branchId }));
  });

  return demands;
}

export function allocateFefoCheckoutLines(params: {
  demands: CheckoutLineDemand[];
  batchesByProduct: Map<string, CheckoutBatchCandidate[]>;
  productNames?: Map<string, string>;
}): CheckoutLineAllocationResult[] {
  const { demands, batchesByProduct, productNames } = params;
  const results: CheckoutLineAllocationResult[] = [];
  const remainingByBatch = new Map<string, number>();

  for (const [productId, batches] of batchesByProduct.entries()) {
    for (const batch of batches) {
      remainingByBatch.set(`${productId}:${batch.id}`, Math.max(0, Number(batch.quantity || 0)));
    }
  }

  for (const demand of demands) {
    const candidates = [...(batchesByProduct.get(demand.productId) || [])]
      .filter(batch => Math.max(0, Number(batch.quantity || 0)) > 0)
      .sort((a, b) => new Date(a.expiryDate || '9999-12-31').getTime() - new Date(b.expiryDate || '9999-12-31').getTime());

    let remaining = demand.baseQuantity;
    const allocations: CheckoutBatchAllocation[] = [];

    for (const candidate of candidates) {
      if (remaining <= 0) break;
      const key = `${demand.productId}:${candidate.id}`;
      const available = remainingByBatch.get(key) || 0;
      if (available <= 0) continue;
      const take = Math.min(remaining, available);
      allocations.push({
        batchId: candidate.id,
        batchNumber: candidate.batchNumber || 'UNSPECIFIED',
        expiryDate: candidate.expiryDate,
        baseQuantity: take,
        costPerBaseUnit: Math.max(0, Number(candidate.costPerBaseUnit || 0))
      });
      remainingByBatch.set(key, available - take);
      remaining -= take;
    }

    if (remaining > 0) {
      const productName = productNames?.get(demand.productId) || demand.productId;
      throw new Error(`Insufficient unexpired FEFO stock for ${productName}. Missing ${remaining} base units.`);
    }

    results.push({
      ...demand,
      allocations,
      actualLineCost: allocations.reduce((sum, allocation) => sum + allocation.baseQuantity * allocation.costPerBaseUnit, 0)
    });
  }

  return results;
}

export function assertCheckoutLineCostFloors(params: {
  items: SaleItem[];
  allocations: CheckoutLineAllocationResult[];
  discountPercentage: number;
  productNames?: Map<string, string>;
}) {
  const { items, allocations, discountPercentage, productNames } = params;
  const discountFactor = 1 - Math.max(0, Number(discountPercentage || 0)) / 100;

  for (const result of allocations) {
    const item = items[result.lineIndex];
    if (!item) throw new Error(`Sale line ${result.lineIndex + 1} disappeared during checkout.`);
    const grossRevenue = Number(item.lineTotal ?? item.subtotal ?? item.total ?? 0);
    const netRevenue = grossRevenue * discountFactor;
    if (netRevenue + 0.0001 < result.actualLineCost) {
      const name = productNames?.get(result.productId) || item.productName || item.name || result.productId;
      const tier = item.tierLabel ? ` ${item.tierLabel}` : '';
      throw new Error(`Checkout blocked after FEFO reallocation: ${name}${tier} would sell below the actual allocated batch cost. Minimum UGX ${Math.ceil(result.actualLineCost).toLocaleString()}, net line revenue UGX ${Math.floor(netRevenue).toLocaleString()}.`);
    }
  }
}

export function getCheckoutProductDeductions(demands: CheckoutLineDemand[]): Map<string, number> {
  const deductions = new Map<string, number>();
  for (const demand of demands) {
    deductions.set(demand.productId, (deductions.get(demand.productId) || 0) + demand.baseQuantity);
  }
  return deductions;
}

export function getCheckoutBatchDeductions(allocations: CheckoutLineAllocationResult[]): Map<string, Map<string, number>> {
  const deductions = new Map<string, Map<string, number>>();
  for (const result of allocations) {
    const productMap = deductions.get(result.productId) || new Map<string, number>();
    for (const allocation of result.allocations) {
      productMap.set(allocation.batchId, (productMap.get(allocation.batchId) || 0) + allocation.baseQuantity);
    }
    deductions.set(result.productId, productMap);
  }
  return deductions;
}

export function finalizeCheckoutSaleItems(
  items: SaleItem[],
  allocations: CheckoutLineAllocationResult[]
): SaleItem[] {
  const byLine = new Map(allocations.map(result => [result.lineIndex, result] as const));

  return items.map((item, lineIndex) => {
    if (item.isService) return item;
    const result = byLine.get(lineIndex);
    if (!result) throw new Error(`Sale line ${lineIndex + 1} has no checkout allocation.`);
    const commercialQuantity = result.commercialQuantity;
    const single = result.allocations.length === 1 ? result.allocations[0] : null;
    const lineTotal = Number(item.lineTotal ?? item.subtotal ?? item.total ?? 0);

    return {
      ...item,
      quantity: commercialQuantity,
      commercialQuantity,
      baseQuantity: result.baseQuantity,
      tierMultiplier: result.tierMultiplier,
      batchId: single?.batchId || '',
      batchNumber: single?.batchNumber || 'FEFO-MULTI',
      expiryDate: single?.expiryDate || 'Multiple',
      batchAllocations: result.allocations,
      actualLineCost: result.actualLineCost,
      costPrice: commercialQuantity > 0 ? result.actualLineCost / commercialQuantity : result.actualLineCost,
      subtotal: lineTotal,
      total: lineTotal,
      lineTotal
    };
  });
}
