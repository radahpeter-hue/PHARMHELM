import type { SaleItem } from '../../types';
import {
  allocateFefoCheckoutLines,
  assertCheckoutLineCostFloors,
  buildCheckoutLineDemands,
  finalizeCheckoutSaleItems,
  getCheckoutBatchDeductions,
  getCheckoutProductDeductions,
  type CheckoutBatchCandidate,
  type CheckoutLineDemand
} from '../posCheckoutTierService';
import { PosCheckoutV2Error, mapCheckoutCalculationError } from './posCheckoutV2Errors';
import type {
  PosCheckoutV2CalculationInput,
  PosCheckoutV2CalculationResult
} from './posCheckoutV2Types';

const EPSILON = 0.0001;

function isUnexpired(expiryDate: string | undefined, now: Date): boolean {
  if (!expiryDate) return false;
  const expiry = new Date(expiryDate);
  if (Number.isNaN(expiry.getTime())) return false;

  const endOfExpiryDay = new Date(expiry);
  endOfExpiryDay.setHours(23, 59, 59, 999);
  return endOfExpiryDay.getTime() >= now.getTime();
}

export function isV2SellableBatch(params: {
  batch: CheckoutBatchCandidate;
  tenantId: string;
  branchId: string;
  productId: string;
  now: Date;
}): boolean {
  const { batch, tenantId, branchId, productId, now } = params;
  const status = String(batch.batchStatus || 'active').trim().toLowerCase();

  return (
    batch.tenantId === tenantId &&
    batch.branchId === branchId &&
    batch.productId === productId &&
    status === 'active' &&
    Number.isFinite(Number(batch.quantity)) &&
    Number(batch.quantity) > 0 &&
    Number.isFinite(Number(batch.costPerBaseUnit)) &&
    Number(batch.costPerBaseUnit) >= 0 &&
    isUnexpired(batch.expiryDate, now)
  );
}

export function filterV2SellableBatches(params: {
  demands: CheckoutLineDemand[];
  batchesByProduct: Map<string, CheckoutBatchCandidate[]>;
  tenantId: string;
  branchId: string;
  now: Date;
}): Map<string, CheckoutBatchCandidate[]> {
  const filtered = new Map<string, CheckoutBatchCandidate[]>();
  const demandedProductIds = new Set(params.demands.map(demand => demand.productId));

  for (const productId of demandedProductIds) {
    const candidates = (params.batchesByProduct.get(productId) || []).filter(batch =>
      isV2SellableBatch({
        batch,
        tenantId: params.tenantId,
        branchId: params.branchId,
        productId,
        now: params.now
      })
    );
    filtered.set(productId, candidates);
  }

  return filtered;
}

function lineGross(item: SaleItem): number {
  const value = Number(item.lineTotal ?? item.subtotal ?? item.total ?? 0);
  if (!Number.isFinite(value) || value < 0) {
    throw new PosCheckoutV2Error('PRICE_CHANGED', `${item.productName || item.name || item.productId} has an invalid line total.`);
  }
  return value;
}

export function calculateCheckoutV2(input: PosCheckoutV2CalculationInput): PosCheckoutV2CalculationResult {
  try {
    if (!input.tenantId) throw new PosCheckoutV2Error('TENANT_MISMATCH', 'Authenticated tenant is required.');
    if (!input.branchId) throw new PosCheckoutV2Error('BRANCH_NOT_AUTHORIZED', 'Active branch is required.');
    if (input.items.length === 0) throw new PosCheckoutV2Error('INVALID_PRODUCT', 'Checkout requires at least one sale item.');

    const discountPercentage = Number(input.discountPercentage || 0);
    if (!Number.isFinite(discountPercentage) || discountPercentage < 0 || discountPercentage > 100) {
      throw new PosCheckoutV2Error('PRICE_CHANGED', 'Discount percentage must be between 0 and 100.');
    }

    const demands = buildCheckoutLineDemands({
      items: input.items,
      liveProducts: input.liveProducts,
      settings: input.settings,
      tenantId: input.tenantId,
      branchId: input.branchId
    });

    const productNames = new Map(
      [...input.liveProducts.entries()].map(([productId, product]) => [productId, product.name] as const)
    );
    const sellableBatches = filterV2SellableBatches({
      demands,
      batchesByProduct: input.batchesByProduct,
      tenantId: input.tenantId,
      branchId: input.branchId,
      now: input.now || new Date()
    });

    for (const demand of demands) {
      const candidates = sellableBatches.get(demand.productId) || [];
      if (candidates.length === 0) {
        throw new PosCheckoutV2Error(
          'NO_SELLABLE_BATCH',
          `No active, unexpired, branch-scoped batch is available for ${productNames.get(demand.productId) || demand.productId}.`,
          { productId: demand.productId }
        );
      }
    }

    const allocations = allocateFefoCheckoutLines({
      demands,
      batchesByProduct: sellableBatches,
      productNames
    });

    assertCheckoutLineCostFloors({
      items: input.items,
      allocations,
      discountPercentage,
      productNames
    });

    const finalizedItems = finalizeCheckoutSaleItems(input.items, allocations);
    const productDeductions = getCheckoutProductDeductions(demands);
    const batchDeductions = getCheckoutBatchDeductions(allocations);
    const grossTotal = input.items.reduce((sum, item) => sum + lineGross(item), 0);
    const discountAmount = grossTotal * (discountPercentage / 100);
    const netTotal = grossTotal - discountAmount;
    const actualCostTotal = allocations.reduce((sum, allocation) => sum + allocation.actualLineCost, 0);

    if (netTotal + EPSILON < 0) {
      throw new PosCheckoutV2Error('PRICE_CHANGED', 'Checkout net total cannot be negative.');
    }

    return {
      demands,
      allocations,
      finalizedItems,
      productDeductions,
      batchDeductions,
      grossTotal,
      discountPercentage,
      discountAmount,
      netTotal,
      actualCostTotal
    };
  } catch (error) {
    throw mapCheckoutCalculationError(error);
  }
}
