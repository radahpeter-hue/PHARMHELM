import type { Product, Sale, SaleItem, Staff, SystemSettings } from '../../types';
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
  paymentMethod?: string;
  secondaryPaymentMethod?: string;
  secondaryAmount?: number;
  welfareAmount?: number;
  welfareBeneficiaryIsStaff?: boolean;
  context?: string;
  sourceQuotationId?: string;
  customerId?: string;
  patientId?: string;
  patientName?: string;
  institutionId?: string;
  institutionName?: string;
  prescriberId?: string;
  prescriberName?: string;
  isExceptionalConsumption?: boolean;
  exceptionalConsumptionReason?: string | null;
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

export interface PosCheckoutV2Authority {
  uid: string;
  tenantId: string;
  staff: Staff;
  branchId: string;
  canOperateSales: boolean;
  branchAuthorized: boolean;
}

export interface PosCheckoutV2AttemptRecord {
  tenantId: string;
  attemptId: string;
  fingerprint: string;
  status: 'completed';
  saleId: string;
  paymentId?: string;
  outboxEventId?: string;
  branchId: string;
  operatorUid: string;
  createdAt?: unknown;
  completedAt?: unknown;
}

export type PosCheckoutV2PaymentStatus = 'completed' | 'unpaid' | 'partially_settled';
export type PosCheckoutV2PaymentComponentStatus = 'settled' | 'unpaid';

export interface PosCheckoutV2PaymentComponent {
  method: string;
  amount: number;
  settledAmount: number;
  outstandingAmount: number;
  status: PosCheckoutV2PaymentComponentStatus;
}

export interface PosCheckoutV2Payment {
  paymentId: string;
  saleId: string;
  receiptNumber: string;
  checkoutAttemptId: string;
  tenantId: string;
  branchId: string;
  customerId?: string;
  patientId?: string;
  institutionId?: string;
  paymentMethod: string;
  currency: 'UGX';
  amount: number;
  settledAmount: number;
  outstandingAmount: number;
  status: PosCheckoutV2PaymentStatus;
  components: PosCheckoutV2PaymentComponent[];
  operatorUid: string;
  source: 'POS';
  engineVersion: 2;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type PosCheckoutV2OutboxStatus = 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED';

export interface PosCheckoutV2OutboxEvent {
  eventId: string;
  eventType: 'POS_SALE_COMMITTED';
  aggregateType: 'POS_SALE';
  aggregateId: string;
  saleId: string;
  paymentId: string;
  receiptNumber: string;
  tenantId: string;
  branchId: string;
  engineVersion: 2;
  payloadVersion: 1;
  status: PosCheckoutV2OutboxStatus;
  attemptCount: number;
  source: 'POS';
  payload: {
    saleId: string;
    paymentId: string;
  };
  createdAt?: unknown;
  availableAt?: unknown;
  processedAt?: unknown;
  lastAttemptAt?: unknown;
  lastError?: string | null;
}

export interface PosCheckoutV2CompletedResult {
  saleId: string;
  receiptNumber: string;
  attemptId: string;
  paymentId?: string;
  outboxEventId?: string;
  sale: Sale;
  payment?: PosCheckoutV2Payment;
  replayed: boolean;
}

export interface PosCheckoutV2TaxResult {
  items: SaleItem[];
  taxAmount: number;
}

export type PosCheckoutV2BatchCandidate = CheckoutBatchCandidate;
export type PosCheckoutV2BatchAllocation = CheckoutBatchAllocation;
export type PosCheckoutV2LineDemand = CheckoutLineDemand;
export type PosCheckoutV2LineAllocation = CheckoutLineAllocationResult;
