import type { Product, SaleItem, SystemSettings } from '../../types';
import type { SellingTierCode, SellingTierFeatureSettings } from '../../types/sellingTier';
import type {
  CheckoutBatchAllocation,
  CheckoutBatchCandidate,
  CheckoutLineAllocationResult,
  CheckoutLineDemand
} from '../posCheckoutTierService';

export type PosCheckoutEngineMode = 'legacy' | 'shadow' | 'v2';

export interface PosCheckoutV2FeatureConfig {
  features?: {
    posCheckoutV2Enabled?: boolean;
  };
  posCheckoutEngine?: PosCheckoutEngineMode;
}

export interface PosCheckoutV2BranchConfig {
  posCheckoutEngine?: PosCheckoutEngineMode;
}

export interface PosCheckoutV2FeatureResolution {
  tenantEnabled: boolean;
  tenantMode: PosCheckoutEngineMode;
  branchOverride?: PosCheckoutEngineMode;
  effectiveMode: PosCheckoutEngineMode;
  reason: 'tenant-disabled' | 'tenant-default' | 'tenant-mode' | 'branch-override';
}

export interface CheckoutV2RequestLine extends SaleItem {
  productId: string;
  commercialQuantity?: number;
  tierCode?: SellingTierCode;
}

export interface CheckoutV2Request {
  attemptId: string;
  branchId: string;
  items: CheckoutV2RequestLine[];
  discountPercentage?: number;
  sourceQuotationId?: string;
  customerId?: string;
  patientId?: string;
  institutionId?: string;
  prescriberId?: string;
}

export interface PosCheckoutV2CalculationInput {
  tenantId: string;
  branchId: string;
  items: SaleItem[];
  liveProducts: Map<string, Product>;
  batchesByProduct: Map<string, CheckoutBatchCandidate[]>;
  settings?: SystemSettings | SellingTierFeatureSettings | null;
  discountPercentage?: number;
  now?: Date;
}

export interface PosCheckoutV2CalculationResult {
  demands: CheckoutLineDemand[];
  allocations: CheckoutLineAllocationResult[];
  finalizedItems: SaleItem[];
  productDeductions: Map<string, number>;
  batchDeductions: Map<string, Map<string, number>>;
  grossTotal: number;
  discountPercentage: number;
  discountAmount: number;
  netTotal: number;
  actualCostTotal: number;
}

export type PosCheckoutV2BatchCandidate = CheckoutBatchCandidate;
export type PosCheckoutV2BatchAllocation = CheckoutBatchAllocation;
export type PosCheckoutV2LineDemand = CheckoutLineDemand;
export type PosCheckoutV2LineAllocation = CheckoutLineAllocationResult;
