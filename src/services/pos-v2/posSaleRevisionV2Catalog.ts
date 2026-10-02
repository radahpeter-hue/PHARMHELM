import type { Product, ProductBatch, SaleItem, SystemSettings } from '../../types';
import type { SellingTierCode } from '../../types/sellingTier';
import { resolveSellingTiers } from '../sellingTierService';
import {
  buildTierCartItem,
  getProductEligibleBatches,
  getProductUsableBaseStock,
  getReservedBaseQuantityForProduct
} from '../posTierCartService';

export interface PosV2RevisionCatalogLineInput {
  product: Product;
  batches: ProductBatch[];
  systemSettings?: SystemSettings | null;
  tenantId: string;
  branchId: string;
  existingItems: SaleItem[];
  requestedTierCode?: SellingTierCode;
}

export interface PosV2RevisionCatalogOption {
  code: SellingTierCode;
  label: string;
  multiplier: number;
  configuredPrice: number | null;
  isDefault: boolean;
}

const requireScope = (tenantId: string, branchId: string) => {
  if (!String(tenantId || '').trim()) throw new Error('Tenant identity is required before adding a revision line.');
  if (!String(branchId || '').trim()) throw new Error('Branch identity is required before adding a revision line.');
};

export function getPosV2RevisionCatalogOptions(
  product: Product,
  systemSettings?: SystemSettings | null
): PosV2RevisionCatalogOption[] {
  const resolution = resolveSellingTiers(product, systemSettings);
  return resolution.tiers.map(tier => ({
    code: tier.code,
    label: tier.label,
    multiplier: tier.multiplier,
    configuredPrice: tier.configuredPrice,
    isDefault: tier.code === resolution.defaultTier.code
  }));
}

/**
 * Builds one candidate revision line using the same live selling-tier and branch-stock
 * helpers as the ordinary POS. This helper is pure: it does not write Firestore,
 * allocate final checkout batches, or submit a revision request.
 */
export function buildPosV2RevisionCatalogLine(input: PosV2RevisionCatalogLineInput): SaleItem {
  const {
    product,
    batches,
    systemSettings,
    tenantId,
    branchId,
    existingItems,
    requestedTierCode
  } = input;

  requireScope(tenantId, branchId);
  if (!product?.id) throw new Error('A valid product is required before adding a revision line.');

  const scopedBatches = getProductEligibleBatches(batches, product.id, { tenantId, branchId });
  const resolution = resolveSellingTiers(product, systemSettings);

  if (resolution.mode === 'multi-tier') {
    const tier = requestedTierCode
      ? resolution.tiers.find(candidate => candidate.code === requestedTierCode)
      : resolution.defaultTier;
    if (!tier) throw new Error('The selected selling tier is not available for this product.');

    const usableBaseStock = getProductUsableBaseStock(scopedBatches, product.id);
    const alreadyReserved = getReservedBaseQuantityForProduct(existingItems, product.id);
    if (alreadyReserved + tier.multiplier > usableBaseStock) {
      throw new Error(`Insufficient stock for one ${tier.label}. ${product.name} has ${Math.max(0, usableBaseStock - alreadyReserved)} unreserved base units available.`);
    }

    return buildTierCartItem({
      product,
      tier,
      batches: scopedBatches,
      tenantId,
      branchId,
      commercialQuantity: 1
    });
  }

  const oldestBatch = scopedBatches[0];
  if (!oldestBatch) throw new Error(`${product.name} has no active unexpired stock in this branch.`);

  const multiplier = product.unitOfSell === 'pack'
    ? Number(product.unitsPerPack || 1)
    : product.unitOfSell === 'strip'
      ? Number(product.unitsPerStrip || 1)
      : 1;
  const usableBaseStock = scopedBatches.reduce((sum, batch) => sum + Math.max(0, Number(batch.quantity || 0)), 0);
  const alreadyReserved = getReservedBaseQuantityForProduct(existingItems, product.id);
  if (!Number.isFinite(multiplier) || multiplier <= 0 || alreadyReserved + multiplier > usableBaseStock) {
    throw new Error(`Insufficient stock for ${product.name}.`);
  }

  const unitPrice = Number(oldestBatch.sellingPrice || 0) * multiplier || Number(product.sellingPricePerUnit || 0);
  const costPrice = Number(oldestBatch.purchasePrice || 0) * multiplier;
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    throw new Error(`${product.name} does not have a valid selling price.`);
  }

  return {
    productId: product.id,
    tenantId,
    branchId,
    batchId: oldestBatch.id || '',
    name: product.name,
    productName: product.name,
    genericName: product.genericName,
    quantity: 1,
    unitPrice,
    actualUnitPrice: unitPrice,
    total: unitPrice,
    subtotal: unitPrice,
    costPrice,
    isService: false,
    batchNumber: oldestBatch.batchNumber,
    expiryDate: oldestBatch.expiryDate
  } as SaleItem;
}
