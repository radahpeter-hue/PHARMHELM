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
  const eligibility = getMultiTierEligibility(product as Product);
  if (!eligibility.eligible) {
    errors.push('Multi-tier selling is only available for tablets, capsules, or products with a valid Unit → Strip → Pack packaging hierarchy.');
    return errors;
  }

  const enabledCodes = SELLING_TIER_CODES.filter(code => product.sellingTiers?.[code]?.enabled === true);
  if (enabledCodes.length === 0) return errors;

  for (const code of enabledCodes) {
    const tier = product.sellingTiers?.[code] as SellingTierConfiguration | undefined;
    const price = Number(tier?.price);
    if (!Number.isFinite(price) || price <= 0) {
      errors.push(`${SELLING_TIER_LABELS[code]} tier requires a selling price greater than zero.`);
    }

    if (code === 'strip') {
      const unitsPerStrip = Number(product.unitsPerStrip);
      if (!Number.isFinite(unitsPerStrip) || unitsPerStrip <= 0) {
        errors.push('Strip tier requires Units per Strip greater than zero.');
      }
    }

    if (code === 'pack') {
      const unitsPerPack = Number(product.unitsPerPack);
      if (!Number.isFinite(unitsPerPack) || unitsPerPack <= 0) {
        errors.push('Pack tier requires Units per Pack greater than zero.');
      }
    }
  }

  const defaultTier = product.defaultSellingTierCode;
  if (!defaultTier || !enabledCodes.includes(defaultTier)) {
    errors.push('Select one enabled tier as the default selling tier.');
  }

  if (enabledCodes.includes('strip') && enabledCodes.includes('pack')) {
    const stripMultiplier = getTierMultiplier(product as Product, 'strip');
    const packMultiplier = getTierMultiplier(product as Product, 'pack');
    if (stripMultiplier && packMultiplier && packMultiplier < stripMultiplier) {
      errors.push('Units per Pack cannot be lower than Units per Strip.');
    }
  }

  return Array.from(new Set(errors));
}

export function applyLegacySellingTierMirror<T extends Partial<Product>>(product: T): T {
  const defaultCode = product.defaultSellingTierCode;
  const defaultTier = defaultCode ? product.sellingTiers?.[defaultCode] : undefined;
  if (!defaultCode || !defaultTier?.enabled || !Number.isFinite(Number(defaultTier.price)) || Number(defaultTier.price) <= 0) {
    return product;
  }

  return {
    ...product,
    unitOfSell: defaultCode,
    sellingPricePerUnit: Number(defaultTier.price),
    sellingTierSchemaVersion: Math.max(1, Number(product.sellingTierSchemaVersion || 0))
  };
}
