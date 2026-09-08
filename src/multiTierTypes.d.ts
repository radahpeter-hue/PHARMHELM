import type {
  SaleTierSnapshotFields,
  SellingTierCode,
  SellingTierMigrationMarker,
  SellingTiers
} from './types/sellingTier';

declare module './types' {
  interface Product {
    sellingTiers?: SellingTiers;
    defaultSellingTierCode?: SellingTierCode;
    sellingTierSchemaVersion?: number;
    sellingTierMigration?: SellingTierMigrationMarker;
  }

  interface SystemSettings {
    features?: {
      multiTierSellingEnabled?: boolean;
    };
  }

  interface SaleItem extends SaleTierSnapshotFields {}
}

export {};
