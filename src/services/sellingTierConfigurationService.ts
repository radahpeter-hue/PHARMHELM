import type { Product } from '../types';
import type { SellingTierCode, SellingTierConfiguration, SellingTiers } from '../types/sellingTier';
import { getMultiTierEligibility, getTierMultiplier } from './sellingTierService';

export const SELLING_TIER_CODES: SellingTierCode[] = ['unit', 'strip', 'pack'];

export const SELLING_TIER_LABELS: Record<SellingTierCode, string> = {
  unit: 'Unit',
  strip: 'Strip',
  pack: 'Pack'
};

export function emptySellingTiers(): SellingTiers {
  return {
    unit: { enabled: false, price: 0 },
    strip: { enabled: false, price: 0 },
    pack: { enabled: false, price: 0 }
  };
}

export function normaliseSellingTiers(product?: Partial<Product> | null): SellingTiers {
  const existing = product?.sellingTiers || {};
  const defaults = emptySellingTiers();
  return SELLING_TIER_CODES.reduce<SellingTiers>((tiers, code) => {
    const current = existing[code];
    tiers[code] = {
      enabled: current?.enabled === true,
      price: Number.isFinite(Number(current?.price)) ? Number(current?.price) : 0
    };
    return tiers;
  }, defaults);
}

export function hasConfiguredSellingTiers(product: Partial<Product>): boolean {
  return SELLING_TIER_CODES.some(code => product.sellingTiers?.[code]?.enabled === true);
}

export function validateSellingTierConfiguration(product: Partial<Product>): string[] {
  if (!hasConfiguredSellingTiers(product)) return [];

  const errors: string[] = [];
  if (!getMultiTierEligibility(product).eligible) {
    errors.push('For this product, enter Units per Pack and track stock in individual units to enable selling tiers.');
    return errors;
  }

  const enabledCodes = SELLING_TIER_CODES.filter(code => product.sellingTiers?.[code]?.enabled === true);

  for (const code of enabledCodes) {
    const tier = product.sellingTiers?.[code] as SellingTierConfiguration | undefined;
    const price = Number(tier?.price);
    if (!Number.isFinite(price) || price <= 0) {
      errors.push(`${SELLING_TIER_LABELS[code]} tier requires a selling price greater than zero.`);
    }

    if (code === 'strip' && getTierMultiplier(product, code) === null) {
      errors.push('Strip tier requires a positive whole number for Units per Strip, up to Units per Pack when provided.');
    }

    if (code === 'pack' && getTierMultiplier(product, code) === null) {
      errors.push('Pack tier requires a positive whole number for Units per Pack.');
    }
  }

  const defaultTier = product.defaultSellingTierCode;
  if (!defaultTier || !enabledCodes.includes(defaultTier)) {
    errors.push('Select one enabled tier as the default selling tier.');
  }

  return Array.from(new Set(errors));
}

/**
 * Maintains safe compatibility with legacy fields while multi-tier selling is enabled.
 *
 * `sellingPricePerUnit` is consumed elsewhere as a true base-unit price when new
 * ProductBatch records are created. It must therefore never be overwritten with a
 * Strip or Pack commercial price. When an explicit Unit tier exists, that Unit price
 * is the only multi-tier price that may synchronize into `sellingPricePerUnit`.
 * Otherwise the existing legacy base-unit value is preserved.
 *
 * `unitOfSell` is also preserved when already present because pre-multi-tier historical
 * records may still rely on that legacy multiplier during reconciliation. New tier-aware
 * POS behaviour uses `defaultSellingTierCode` directly and does not need this legacy
 * field to be rewritten.
 */
export function applyLegacySellingTierMirror<T extends Partial<Product>>(product: T): T {
  const defaultCode = product.defaultSellingTierCode;
  const defaultTier = defaultCode ? product.sellingTiers?.[defaultCode] : undefined;
  if (!defaultCode || !defaultTier?.enabled || !Number.isFinite(Number(defaultTier.price)) || Number(defaultTier.price) <= 0) {
    return product;
  }

  const unitTier = product.sellingTiers?.unit;
  const unitTierPrice = unitTier?.enabled && Number.isFinite(Number(unitTier.price)) && Number(unitTier.price) > 0
    ? Number(unitTier.price)
    : null;

  return {
    ...product,
    unitOfSell: product.unitOfSell || defaultCode,
    sellingPricePerUnit: unitTierPrice ?? product.sellingPricePerUnit,
    sellingTierSchemaVersion: Math.max(1, Number(product.sellingTierSchemaVersion || 0))
  };
}
