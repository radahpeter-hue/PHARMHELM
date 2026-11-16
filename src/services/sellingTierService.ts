import type { Product, SystemSettings } from '../types';
import type {
  MultiTierEligibility,
  ResolvedSellingTier,
  SaleTierSnapshotFields,
  SellingTierCode,
  SellingTierFeatureSettings,
  SellingTierResolution
} from '../types/sellingTier';

const TIER_ORDER: SellingTierCode[] = ['unit', 'strip', 'pack'];

const TIER_LABELS: Record<SellingTierCode, ResolvedSellingTier['label']> = {
  unit: 'Unit',
  strip: 'Strip',
  pack: 'Pack'
};

const normalise = (value: unknown) => String(value ?? '').trim().toLowerCase();

const positiveNumber = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

const isPackWord = (value: unknown) => {
  const normalised = normalise(value);
  return ['pack', 'packs', 'packet', 'packets'].includes(normalised);
};

const normaliseLegacyTierCode = (value: unknown): SellingTierCode => {
  const normalised = normalise(value);
  if (normalised === 'strip') return 'strip';
  if (normalised === 'pack' || normalised === 'packet') return 'pack';
  return 'unit';
};

export function isMultiTierSellingEnabled(
  settings?: SystemSettings | SellingTierFeatureSettings | null
): boolean {
  return settings?.features?.multiTierSellingEnabled === true;
}

export function getTierMultiplier(product: Partial<Product>, tierCode: SellingTierCode): number | null {
  if (tierCode === 'unit') return 1;
  const pack = positiveNumber(product.unitsPerPack);
  const count = tierCode === 'strip' ? positiveNumber(product.unitsPerStrip) : pack;
  if (count === null || !Number.isSafeInteger(count)) return null;
  return tierCode === 'strip' && pack !== null && count > pack ? null : count;
}

export function getMultiTierEligibility(product: Partial<Product>): MultiTierEligibility {
  const dosageForm = normalise(product.dosageForm).replace(/[^a-z]/g, '');
  if (['tablet', 'tablets', 'capsule', 'capsules'].includes(dosageForm)) {
    return { eligible: true, reason: 'tablet-or-capsule' };
  }

  const unitsPerPack = getTierMultiplier(product, 'pack');
  if (unitsPerPack !== null && !isPackWord(product.baseUnit || product.unit)) {
    const hasStrip = unitsPerPack > 1 && getTierMultiplier(product, 'strip') !== null;
    return { eligible: true, reason: hasStrip ? 'unit-strip-pack-hierarchy' : 'unit-pack' };
  }

  return { eligible: false, reason: 'not-eligible' };
}

export function isMultiTierEligibleProduct(product: Product): boolean {
  return getMultiTierEligibility(product).eligible;
}

export function resolveLegacySellingTier(product: Product): ResolvedSellingTier {
  const code = normaliseLegacyTierCode(product.unitOfSell || product.unit);
  const packagingCount = code === 'strip' ? product.unitsPerStrip : product.unitsPerPack;
  const multiplier = code === 'unit' ? 1 : positiveNumber(packagingCount) ?? 1;

  return {
    code,
    label: TIER_LABELS[code],
    multiplier,
    configuredPrice: null,
    priceSource: 'legacy'
  };
}

function legacyResolution(
  product: Product,
  featureEnabled: boolean,
  eligibility: MultiTierEligibility,
  warnings: string[] = []
): SellingTierResolution {
  const legacyTier = resolveLegacySellingTier(product);
  return {
    mode: 'legacy',
    featureEnabled,
    eligible: eligibility.eligible,
    eligibilityReason: eligibility.reason,
    tiers: [legacyTier],
    defaultTier: legacyTier,
    warnings
  };
}

export function resolveSellingTiers(
  product: Product,
  settings?: SystemSettings | SellingTierFeatureSettings | null
): SellingTierResolution {
  const featureEnabled = isMultiTierSellingEnabled(settings);
  const eligibility = getMultiTierEligibility(product);

  if (!featureEnabled || !eligibility.eligible) {
    return legacyResolution(product, featureEnabled, eligibility);
  }

  const warnings: string[] = [];
  const resolvedTiers: ResolvedSellingTier[] = [];

  for (const code of TIER_ORDER) {
    const config = product.sellingTiers?.[code];
    if (!config?.enabled) continue;

    const multiplier = getTierMultiplier(product, code);
    if (multiplier === null) {
      warnings.push(`${TIER_LABELS[code]} tier is enabled but its packaging multiplier is missing or invalid.`);
      continue;
    }

    const configuredPrice = positiveNumber(config.price);
    if (configuredPrice === null) {
      warnings.push(`${TIER_LABELS[code]} tier is enabled but has no valid configured price.`);
      continue;
    }

    resolvedTiers.push({
      code,
      label: TIER_LABELS[code],
      multiplier,
      configuredPrice,
      priceSource: 'configured-tier'
    });
  }

  if (resolvedTiers.length === 0) {
    warnings.push('No valid enabled selling tier is available. Legacy POS behaviour will be used.');
    return legacyResolution(product, featureEnabled, eligibility, warnings);
  }

  const configuredDefault = product.defaultSellingTierCode;
  const resolvedDefault = configuredDefault
    ? resolvedTiers.find(tier => tier.code === configuredDefault)
    : undefined;

  if (resolvedDefault) {
    return {
      mode: 'multi-tier',
      featureEnabled,
      eligible: true,
      eligibilityReason: eligibility.reason,
      tiers: resolvedTiers,
      defaultTier: resolvedDefault,
      warnings
    };
  }

  if (resolvedTiers.length === 1) {
    warnings.push('The configured default tier is missing or invalid. The only valid enabled tier will be used as default.');
    return {
      mode: 'multi-tier',
      featureEnabled,
      eligible: true,
      eligibilityReason: eligibility.reason,
      tiers: resolvedTiers,
      defaultTier: resolvedTiers[0],
      warnings
    };
  }

  warnings.push('Multiple valid selling tiers exist but the default tier is missing or invalid. Legacy POS behaviour will be used.');
  return legacyResolution(product, featureEnabled, eligibility, warnings);
}

export function resolveRequestedSellingTier(
  product: Product,
  settings?: SystemSettings | SellingTierFeatureSettings | null,
  requestedTierCode?: SellingTierCode | null
): ResolvedSellingTier {
  const resolution = resolveSellingTiers(product, settings);

  if (resolution.mode === 'legacy' || !requestedTierCode) {
    return resolution.defaultTier;
  }

  const tier = resolution.tiers.find(candidate => candidate.code === requestedTierCode);
  if (!tier) {
    throw new Error(`${TIER_LABELS[requestedTierCode]} selling tier is not currently available for this product.`);
  }

  return tier;
}

export function resolveSellingTierPrice(tier: ResolvedSellingTier, legacyBaseUnitPrice: number): number {
  if (tier.configuredPrice !== null) return tier.configuredPrice;
  const baseUnitPrice = Number(legacyBaseUnitPrice);
  return Number.isFinite(baseUnitPrice) && baseUnitPrice >= 0 ? baseUnitPrice * tier.multiplier : 0;
}

export function calculateBaseQuantity(commercialQuantity: number, tierMultiplier: number): number {
  if (!Number.isFinite(commercialQuantity) || commercialQuantity <= 0 || !Number.isInteger(commercialQuantity)) {
    throw new Error('Commercial quantity must be a positive whole number.');
  }
  if (!Number.isFinite(tierMultiplier) || tierMultiplier <= 0) {
    throw new Error('Selling tier multiplier must be greater than zero.');
  }

  return commercialQuantity * tierMultiplier;
}

export function buildSaleTierSnapshot(params: {
  product: Product;
  tier: ResolvedSellingTier;
  commercialQuantity: number;
  actualUnitPrice: number;
  discountStatus?: string;
  taxStatus?: string;
  actualLineCost?: number;
  lineTotal?: number;
}): SaleTierSnapshotFields {
  const {
    product,
    tier,
    commercialQuantity,
    actualUnitPrice,
    discountStatus = 'none',
    taxStatus = 'pending',
    actualLineCost,
    lineTotal
  } = params;

  if (!Number.isFinite(actualUnitPrice) || actualUnitPrice < 0) {
    throw new Error('Actual selling price cannot be negative.');
  }

  const baseQuantity = calculateBaseQuantity(commercialQuantity, tier.multiplier);
  const resolvedLineTotal = lineTotal ?? commercialQuantity * actualUnitPrice;

  return {
    dosageFormSnapshot: product.dosageForm || '',
    tierCode: tier.code,
    tierLabel: tier.label,
    tierMultiplier: tier.multiplier,
    commercialQuantity,
    baseQuantity,
    configuredPrice: tier.configuredPrice ?? actualUnitPrice,
    actualUnitPrice,
    priceSource: tier.priceSource,
    discountStatus,
    taxStatus,
    actualLineCost,
    lineTotal: resolvedLineTotal
  };
}
