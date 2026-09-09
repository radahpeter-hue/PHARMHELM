import type { Product, ProductBatch, SaleItem } from '../types';
import type { ResolvedSellingTier, SellingTierCode } from '../types/sellingTier';
import { buildSaleTierSnapshot } from './sellingTierService';
import { createSaleLineId } from './saleTierHistoryService';

const normaliseExpiry = (expiryDate?: string, now: Date = new Date()): boolean => {
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
    if (Number.isNaN(expiry.getTime())) return false;
  }
  return expiry.getTime() >= now.getTime();
};

export function getCartLineIdentity(item: SaleItem): string {
  if (item.isService) return `service:${item.productId}`;
  if (item.tierCode) {
    return [
      'tier',
      item.productId,
      item.tierCode,
      Number(item.tierMultiplier || 0),
      Number(item.actualUnitPrice ?? item.unitPrice ?? 0),
      Number(item.configuredPrice ?? 0),
      item.priceSource || 'configured-tier',
      item.taxStatus || 'pending',
      item.discountStatus || 'none'
    ].join(':');
  }
  return `legacy:${item.productId}:${item.batchNumber || 'N/A'}`;
}

export function getProductUsableBaseStock(
  batches: ProductBatch[],
  productId: string,
  now: Date = new Date()
): number {
  return batches
    .filter(batch => batch.productId === productId)
    .filter(batch => String(batch.batch_status || '').toLowerCase() === 'active')
    .filter(batch => normaliseExpiry(batch.expiryDate, now))
    .reduce((sum, batch) => sum + Math.max(0, Number(batch.quantity || 0)), 0);
}

export function getSaleItemBaseQuantity(item: SaleItem): number {
  const explicitBaseQuantity = Number(item.baseQuantity);
  if (Number.isFinite(explicitBaseQuantity) && explicitBaseQuantity >= 0) return explicitBaseQuantity;

  const commercialQuantity = Number(item.commercialQuantity ?? item.quantity ?? 0);
  const multiplier = Number(item.tierMultiplier || 0);
  if (Number.isFinite(commercialQuantity) && commercialQuantity >= 0 && Number.isFinite(multiplier) && multiplier > 0) {
    return commercialQuantity * multiplier;
  }
  return 0;
}

export function getReservedBaseQuantityForProduct(cart: SaleItem[], productId: string): number {
  return cart
    .filter(item => !item.isService && item.productId === productId)
    .reduce((sum, item) => sum + getSaleItemBaseQuantity(item), 0);
}

export function estimateFefoLineCost(
  batches: ProductBatch[],
  productId: string,
  requestedBaseQuantity: number,
  now: Date = new Date()
): { available: boolean; actualLineCost: number; coveredBaseQuantity: number } {
  const candidates = batches
    .filter(batch => batch.productId === productId)
    .filter(batch => String(batch.batch_status || '').toLowerCase() === 'active')
    .filter(batch => normaliseExpiry(batch.expiryDate, now))
    .filter(batch => Number(batch.quantity || 0) > 0)
    .sort((a, b) => new Date(a.expiryDate || '9999-12-31').getTime() - new Date(b.expiryDate || '9999-12-31').getTime());

  let remaining = Math.max(0, requestedBaseQuantity);
  let actualLineCost = 0;
  let coveredBaseQuantity = 0;

  for (const batch of candidates) {
    if (remaining <= 0) break;
    const available = Math.max(0, Number(batch.quantity || 0));
    const take = Math.min(available, remaining);
    if (take <= 0) continue;
    actualLineCost += take * Math.max(0, Number(batch.purchasePrice || 0));
    coveredBaseQuantity += take;
    remaining -= take;
  }

  return {
    available: remaining <= 0,
    actualLineCost,
    coveredBaseQuantity
  };
}

export function buildTierCartItem(params: {
  product: Product;
  tier: ResolvedSellingTier;
  batches: ProductBatch[];
  tenantId: string;
  branchId: string;
  commercialQuantity?: number;
}): SaleItem {
  const { product, tier, batches, tenantId, branchId, commercialQuantity = 1 } = params;
  if (tier.configuredPrice === null || tier.configuredPrice <= 0) {
    throw new Error(`${tier.label} tier does not have a valid configured price.`);
  }

  const snapshot = buildSaleTierSnapshot({
    product,
    tier,
    commercialQuantity,
    actualUnitPrice: tier.configuredPrice,
    discountStatus: 'none',
    taxStatus: product.vatClassification || 'pending'
  });
  const cost = estimateFefoLineCost(batches, product.id, snapshot.baseQuantity || 0);
  if (!cost.available) {
    throw new Error(`Insufficient unexpired stock for ${product.name} ${tier.label}.`);
  }

  return {
    lineId: createSaleLineId(),
    productId: product.id,
    tenantId,
    branchId,
    batchId: '',
    name: product.name,
    productName: product.name,
    genericName: product.genericName,
    quantity: commercialQuantity,
    commercialQuantity,
    unitPrice: tier.configuredPrice,
    total: commercialQuantity * tier.configuredPrice,
    subtotal: commercialQuantity * tier.configuredPrice,
    costPrice: commercialQuantity > 0 ? cost.actualLineCost / commercialQuantity : cost.actualLineCost,
    batchNumber: 'FEFO-PENDING',
    expiryDate: 'Allocated at checkout',
    isService: false,
    ...snapshot,
    actualLineCost: cost.actualLineCost
  } as SaleItem;
}

export function mergeTierCartItem(cart: SaleItem[], incoming: SaleItem): SaleItem[] {
  const identity = getCartLineIdentity(incoming);
  const existingIndex = cart.findIndex(item => getCartLineIdentity(item) === identity);
  if (existingIndex < 0) return [incoming, ...cart];

  return cart.map((item, index) => {
    if (index !== existingIndex) return item;
    const commercialQuantity = Number(item.commercialQuantity ?? item.quantity ?? 0) + Number(incoming.commercialQuantity ?? incoming.quantity ?? 0);
    const baseQuantity = getSaleItemBaseQuantity(item) + getSaleItemBaseQuantity(incoming);
    const lineTotal = Number(item.lineTotal ?? item.subtotal ?? 0) + Number(incoming.lineTotal ?? incoming.subtotal ?? 0);
    const actualLineCost = Number(item.actualLineCost || 0) + Number(incoming.actualLineCost || 0);
    return {
      ...item,
      quantity: commercialQuantity,
      commercialQuantity,
      baseQuantity,
      subtotal: lineTotal,
      total: lineTotal,
      lineTotal,
      actualLineCost,
      costPrice: commercialQuantity > 0 ? actualLineCost / commercialQuantity : actualLineCost
    };
  });
}

export function replaceTierCartQuantity(params: {
  cart: SaleItem[];
  targetIdentity: string;
  product: Product;
  batches: ProductBatch[];
  commercialQuantity: number;
}): SaleItem[] {
  const { cart, targetIdentity, product, batches, commercialQuantity } = params;
  if (!Number.isInteger(commercialQuantity) || commercialQuantity < 0) {
    throw new Error('Commercial quantity must be a whole number of units, strips or packs.');
  }

  const target = cart.find(item => getCartLineIdentity(item) === targetIdentity);
  if (!target || !target.tierCode || !target.tierMultiplier) return cart;
  if (commercialQuantity === 0) return cart.filter(item => getCartLineIdentity(item) !== targetIdentity);

  const requestedBaseQuantity = commercialQuantity * Number(target.tierMultiplier);
  const otherReserved = cart
    .filter(item => item.productId === product.id && getCartLineIdentity(item) !== targetIdentity)
    .reduce((sum, item) => sum + getSaleItemBaseQuantity(item), 0);
  const totalUsable = getProductUsableBaseStock(batches, product.id);
  if (otherReserved + requestedBaseQuantity > totalUsable) {
    throw new Error(`Insufficient stock. ${product.name} has ${totalUsable} usable base units available.`);
  }

  const cost = estimateFefoLineCost(batches, product.id, requestedBaseQuantity);
  const lineTotal = commercialQuantity * Number(target.unitPrice || 0);
  return cart.map(item => {
    if (getCartLineIdentity(item) !== targetIdentity) return item;
    return {
      ...item,
      quantity: commercialQuantity,
      commercialQuantity,
      baseQuantity: requestedBaseQuantity,
      subtotal: lineTotal,
      total: lineTotal,
      lineTotal,
      actualLineCost: cost.actualLineCost,
      costPrice: commercialQuantity > 0 ? cost.actualLineCost / commercialQuantity : cost.actualLineCost
    };
  });
}

export function replaceTierCartPrice(params: {
  cart: SaleItem[];
  targetIdentity: string;
  actualUnitPrice: number;
}): SaleItem[] {
  const { cart, targetIdentity, actualUnitPrice } = params;
  if (!Number.isFinite(actualUnitPrice) || actualUnitPrice < 0) throw new Error('Selling price cannot be negative.');

  return cart.map(item => {
    if (getCartLineIdentity(item) !== targetIdentity) return item;
    const commercialQuantity = Number(item.commercialQuantity ?? item.quantity ?? 0);
    const lineTotal = commercialQuantity * actualUnitPrice;
    return {
      ...item,
      unitPrice: actualUnitPrice,
      actualUnitPrice,
      priceSource: actualUnitPrice === Number(item.configuredPrice) ? 'configured-tier' : 'manual-override',
      subtotal: lineTotal,
      total: lineTotal,
      lineTotal
    };
  });
}

export function tierLabelForCode(code?: SellingTierCode): string {
  if (code === 'strip') return 'Strip';
  if (code === 'pack') return 'Pack';
  return 'Unit';
}
