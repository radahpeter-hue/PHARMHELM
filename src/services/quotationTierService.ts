import type { Product, ProductBatch, SaleItem, SystemSettings } from '../types';
import type { SellingTierFeatureSettings } from '../types/sellingTier';
import { resolveSellingTiers } from './sellingTierService';
import {
  buildTierCartItem,
  estimateFefoLineCost,
  getProductUsableBaseStock,
  replaceTierCartPrice
} from './posTierCartService';
import { createSaleLineId } from './saleTierHistoryService';

export interface QuotationLineSnapshot {
  lineId: string;
  productId: string;
  productName: string;
  genericName?: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  isService?: boolean;
  dosageFormSnapshot?: string;
  tierCode?: SaleItem['tierCode'];
  tierLabel?: string;
  tierMultiplier?: number;
  commercialQuantity?: number;
  baseQuantity?: number;
  configuredPrice?: number;
  actualUnitPrice?: number;
  priceSource?: string;
  discountStatus?: string;
  taxStatus?: string;
}

export interface QuotationResumeResult {
  item: SaleItem | null;
  warnings: string[];
  blocking: boolean;
}

const nearlyEqual = (a: number, b: number) => Math.abs(a - b) < 0.0001;

export function buildQuotationLineSnapshot(item: SaleItem): QuotationLineSnapshot {
  const commercialQuantity = Number(item.commercialQuantity ?? item.quantity ?? 0);
  const actualUnitPrice = Number(item.actualUnitPrice ?? item.unitPrice ?? 0);
  const lineTotal = Number(item.lineTotal ?? item.subtotal ?? item.total ?? commercialQuantity * actualUnitPrice);
  return {
    lineId: item.lineId || createSaleLineId(item.isService ? 'service-quote-line' : 'quote-line'),
    productId: item.productId,
    productName: item.productName || item.name,
    genericName: item.genericName || '',
    qty: commercialQuantity,
    unitPrice: actualUnitPrice,
    lineTotal,
    isService: Boolean(item.isService),
    dosageFormSnapshot: item.dosageFormSnapshot,
    tierCode: item.tierCode,
    tierLabel: item.tierLabel,
    tierMultiplier: item.tierMultiplier,
    commercialQuantity,
    baseQuantity: item.baseQuantity,
    configuredPrice: item.configuredPrice,
    actualUnitPrice,
    priceSource: item.priceSource,
    discountStatus: item.discountStatus,
    taxStatus: item.taxStatus
  };
}

export function quotationQuantityText(line: Partial<QuotationLineSnapshot>): string {
  const quantity = Number(line.commercialQuantity ?? line.qty ?? 0);
  const label = line.tierLabel || (line.tierCode === 'strip' ? 'Strip' : line.tierCode === 'pack' ? 'Pack' : line.tierCode === 'unit' ? 'Unit' : '');
  if (!label) return String(quantity);
  const commercial = `${quantity} ${quantity === 1 ? label : `${label}s`}`;
  const base = Number(line.baseQuantity);
  return Number.isFinite(base) && base >= 0 ? `${commercial} (${base} base units)` : commercial;
}

export function buildResumedServiceLine(line: QuotationLineSnapshot): SaleItem {
  const quantity = Number(line.commercialQuantity ?? line.qty ?? 0);
  const unitPrice = Number(line.actualUnitPrice ?? line.unitPrice ?? 0);
  return {
    lineId: line.lineId || createSaleLineId('service-line'),
    productId: line.productId,
    batchId: '',
    name: line.productName,
    productName: line.productName,
    genericName: line.genericName,
    quantity,
    commercialQuantity: quantity,
    unitPrice,
    actualUnitPrice: unitPrice,
    total: quantity * unitPrice,
    subtotal: quantity * unitPrice,
    lineTotal: quantity * unitPrice,
    isService: true
  } as SaleItem;
}

export function buildResumedQuotationProductLine(params: {
  line: QuotationLineSnapshot;
  product: Product;
  batches: ProductBatch[];
  settings?: SystemSettings | SellingTierFeatureSettings | null;
  tenantId: string;
  branchId: string;
}): QuotationResumeResult {
  const { line, product, batches, settings, tenantId, branchId } = params;
  const warnings: string[] = [];
  const quantity = Number(line.commercialQuantity ?? line.qty ?? 0);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { item: null, warnings: [`${line.productName} has an invalid quoted quantity.`], blocking: true };
  }
  if (product.tenantId !== tenantId) {
    return { item: null, warnings: [`${line.productName} failed tenant validation.`], blocking: true };
  }

  if (line.tierCode) {
    const resolution = resolveSellingTiers(product, settings);
    if (resolution.mode !== 'multi-tier') {
      return { item: null, warnings: [`${line.productName} is no longer configured for multi-tier selling.`], blocking: true };
    }
    const liveTier = resolution.tiers.find(tier => tier.code === line.tierCode);
    if (!liveTier || liveTier.configuredPrice === null) {
      return { item: null, warnings: [`${line.productName} ${line.tierLabel || line.tierCode} tier is no longer enabled.`], blocking: true };
    }
    const quotedMultiplier = Number(line.tierMultiplier || 0);
    if (!Number.isFinite(quotedMultiplier) || quotedMultiplier <= 0 || !nearlyEqual(quotedMultiplier, liveTier.multiplier)) {
      return {
        item: null,
        warnings: [`${line.productName} ${liveTier.label} packaging changed from ${quotedMultiplier || 'unknown'} to ${liveTier.multiplier} base units. Re-add this line manually before sale.`],
        blocking: true
      };
    }

    let item: SaleItem;
    try {
      item = buildTierCartItem({ product, tier: liveTier, batches, tenantId, branchId, commercialQuantity: quantity });
    } catch (error: any) {
      return { item: null, warnings: [error?.message || `Insufficient stock for ${line.productName}.`], blocking: true };
    }

    const quotedPrice = Number(line.actualUnitPrice ?? line.unitPrice ?? 0);
    if (!Number.isFinite(quotedPrice) || quotedPrice < 0) {
      return { item: null, warnings: [`${line.productName} has an invalid quoted price.`], blocking: true };
    }
    if (!nearlyEqual(quotedPrice, liveTier.configuredPrice)) {
      warnings.push(`Price for ${line.productName} ${liveTier.label} changed from UGX ${quotedPrice.toLocaleString()} to UGX ${liveTier.configuredPrice.toLocaleString()}. Continuing retains the quotation price as a manual override.`);
      item = replaceTierCartPrice({ cart: [item], targetIdentity: item.tierCode ? [
        'tier', item.productId, item.tierCode, Number(item.tierMultiplier || 0), Number(item.actualUnitPrice ?? item.unitPrice ?? 0),
        Number(item.configuredPrice ?? 0), item.priceSource || 'configured-tier', item.taxStatus || 'pending', item.discountStatus || 'none'
      ].join(':') : '', actualUnitPrice: quotedPrice })[0];
    }
    item = { ...item, lineId: line.lineId || item.lineId || createSaleLineId() };
    return { item, warnings, blocking: false };
  }

  const unit = String(product.unitOfSell || product.unit || '').trim().toLowerCase();
  const multiplier = unit === 'pack'
    ? Math.max(1, Number(product.unitsPerPack || 1))
    : unit === 'strip'
      ? Math.max(1, Number(product.unitsPerStrip || 1))
      : 1;
  const requestedBaseQuantity = quantity * multiplier;
  const availableBaseQuantity = getProductUsableBaseStock(batches, product.id);
  if (availableBaseQuantity < requestedBaseQuantity) {
    return {
      item: null,
      warnings: [`Stock on Hand for ${line.productName} is insufficient. Requested: ${requestedBaseQuantity}, Available: ${availableBaseQuantity} base units.`],
      blocking: true
    };
  }

  const activeBatches = batches
    .filter(batch => batch.productId === product.id && String(batch.batch_status || '').toLowerCase() === 'active' && Number(batch.quantity || 0) > 0)
    .sort((a, b) => new Date(a.expiryDate || '9999-12-31').getTime() - new Date(b.expiryDate || '9999-12-31').getTime());
  const currentCommercialPrice = activeBatches[0]
    ? Number(activeBatches[0].sellingPrice || product.sellingPricePerUnit || 0) * multiplier
    : Number(product.sellingPricePerUnit || 0) * multiplier;
  const quotedPrice = Number(line.actualUnitPrice ?? line.unitPrice ?? currentCommercialPrice);
  if (currentCommercialPrice > 0 && !nearlyEqual(quotedPrice, currentCommercialPrice)) {
    warnings.push(`Price for ${line.productName} changed from UGX ${quotedPrice.toLocaleString()} to UGX ${currentCommercialPrice.toLocaleString()}. Continuing retains the quotation price.`);
  }
  const cost = estimateFefoLineCost(batches, product.id, requestedBaseQuantity);
  if (!cost.available) return { item: null, warnings: [`Insufficient unexpired stock for ${line.productName}.`], blocking: true };
  const lineTotal = quantity * quotedPrice;
  return {
    item: {
      lineId: line.lineId || createSaleLineId(),
      productId: product.id,
      tenantId,
      branchId,
      batchId: '',
      name: product.name,
      productName: product.name,
      genericName: product.genericName,
      quantity,
      commercialQuantity: quantity,
      baseQuantity: requestedBaseQuantity,
      tierMultiplier: multiplier,
      unitPrice: quotedPrice,
      actualUnitPrice: quotedPrice,
      configuredPrice: currentCommercialPrice || quotedPrice,
      priceSource: currentCommercialPrice > 0 && !nearlyEqual(quotedPrice, currentCommercialPrice) ? 'manual-override' : 'legacy',
      total: lineTotal,
      subtotal: lineTotal,
      lineTotal,
      costPrice: quantity > 0 ? cost.actualLineCost / quantity : cost.actualLineCost,
      actualLineCost: cost.actualLineCost,
      batchNumber: 'FEFO-PENDING',
      expiryDate: 'Allocated at checkout',
      isService: false
    } as SaleItem,
    warnings,
    blocking: false
  };
}
