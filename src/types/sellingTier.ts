export type SellingTierCode = 'unit' | 'strip' | 'pack';

export type SellingTierPriceSource = 'configured-tier' | 'legacy';

export interface SellingTierConfiguration {
  enabled: boolean;
  price: number;
}

export type SellingTiers = Partial<Record<SellingTierCode, SellingTierConfiguration>>;

export interface SellingTierMigrationMarker {
  version: number;
  migratedAt?: string;
  migratedBy?: string;
  status?: 'migrated' | 'manual_review' | 'blocked';
  sourceUnitOfSell?: string;
}

export interface SellingTierFeatureSettings {
  features?: {
    multiTierSellingEnabled?: boolean;
  };
}

export interface ResolvedSellingTier {
  code: SellingTierCode;
  label: 'Unit' | 'Strip' | 'Pack';
  multiplier: number;
  configuredPrice: number | null;
  priceSource: SellingTierPriceSource;
}

export type MultiTierEligibilityReason =
  | 'tablet-or-capsule'
  | 'unit-strip-pack-hierarchy'
  | 'not-eligible';

export interface MultiTierEligibility {
  eligible: boolean;
  reason: MultiTierEligibilityReason;
}

export interface SellingTierResolution {
  mode: 'legacy' | 'multi-tier';
  featureEnabled: boolean;
  eligible: boolean;
  eligibilityReason: MultiTierEligibilityReason;
  tiers: ResolvedSellingTier[];
  defaultTier: ResolvedSellingTier;
  warnings: string[];
}

export interface SaleTierSnapshotFields {
  dosageFormSnapshot?: string;
  tierCode?: SellingTierCode;
  tierLabel?: string;
  tierMultiplier?: number;
  commercialQuantity?: number;
  baseQuantity?: number;
  configuredPrice?: number;
  actualUnitPrice?: number;
  priceSource?: SellingTierPriceSource | string;
  discountStatus?: string;
  taxStatus?: string;
  actualLineCost?: number;
  lineTotal?: number;
}
