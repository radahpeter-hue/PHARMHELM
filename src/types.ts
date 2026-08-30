export type UserRole =
  | 'owner'
  | 'admin'
  | 'CEO'
  | 'CEO / MD'
  | 'Branch Manager'
  | 'cashier'
  | 'pharmacist'
  | 'Dispenser'
  | 'Finance Head'
  | 'Finance Officer'
  | 'Accountant'
  | 'HR Head'
  | 'HR Support Personnel'
  | 'QA Head'
  | 'QA Officer'
  | 'Procurement Head'
  | 'Procurement Officer'
  | 'Logistics Head'
  | 'Transport & Logistics Personnel'
  | 'IT Head'
  | 'IT Support Staff'
  | 'Marketing Head'
  | 'Marketing Personnel'
  | 'Trainee'
  | 'Cleaner'
  | 'Staff'
  | string;

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  country: string;
  nda_reg_number: string;
  brand_colour: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  subscription_tier: 'basic' | 'standard' | 'enterprise';
  subscription_status: 'active' | 'inactive' | 'trial' | 'past_due' | 'unsubscribed' | 'expired';
  subscription_cycle: 'monthly' | 'annual';
  subscription_start: string;
  subscription_end: string;
  modules_enabled: string[];
  deployment_mode: 'single_branch' | 'multi_branch';
  status: 'active' | 'inactive' | 'suspended' | 'deleted';
  created_at: string;
  created_by: string;
  acronym?: string;
  branding?: {
    companyName: string;
    ndaRegNumber: string;
    receiptFooter: string;
    logoUrl?: string;
  };
  deleted?: boolean;
  deleted_at?: string;
  deletedAt?: string;
  deleted_expires_at?: string;
  original_slug?: string;
}

export interface Branch {
  id: string;
  tenantId: string;
  name: string;
  branch_code: string;
  type: string; // Changed to string to be more flexible as per user examples
  status: 'Active' | 'Inactive' | 'Closed';
  address: string;
  phone: string;
  isMainBranch?: boolean;
  license_number?: string;
  license_expiry?: string;
  brandName?: string;
  brandPrimaryColor?: string;
  brandSecondaryColor?: string;
  brandSlogan?: string;
  brandLogoUrl?: string;
  brandNdaRegNumber?: string;
  brandReceiptFooter?: string;
  shifts?: BranchShifts;
  created_at: string;
  created_by: string;
}

export interface ShiftConfig {
  enabled: boolean;
  startTime: string;
  endTime: string;
}

export interface BranchShifts {
  dayShift: ShiftConfig;
  eveningShift: ShiftConfig;
  nightShift: ShiftConfig;
}

export interface Staff {
  id: string;
  uid: string;
  legacyStaffId?: string | null;
  tenantId: string;
  username: string;
  full_name: string;
  displayName?: string;
  email: string;
  phone_number: string;
  role: UserRole;
  branch_id: string;
  assigned_branches: string[];
  default_branch_id: string | null;
  status: 'active' | 'inactive' | 'suspended' | 'pending_it';
  active: boolean;
  password_set: boolean;
  password?: string;
  created_at: string;
  updatedAt?: string;
  jobTitle?: string;
  startDate?: string;
  employmentStatus?: string;
  remunerationType?: string;
  remunerationRate?: number;
  paymentMethod?: string;
  paymentDetails?: string;
  cadre?: string;
  licenseNumber?: string;
  licenseExpiryDate?: string;
  nssfEligible?: boolean;
  employmentType?: 'Full-Time' | 'Part-Time' | 'Resident Consultant' | 'Non-Resident Consultant' | 'Independent Contractor / Self-Employed' | 'Consultant' | 'Locum';
  tin?: string;
  salary_base?: number;
  expected_work_hours_per_day?: number;
  expected_days_per_month?: number;
  secondaryRoles?: string[];
  welfare_limit?: number;
  welfare_spent?: number;
}

export interface PlatformUser {
  id: string;
  email: string;
  role: 'super_admin' | 'support' | 'sales' | 'super_operator' | 'tmc_handler';
  full_name: string;
  name?: string;
  active: boolean;
  created_at: string;
  password_hash?: string;
  password?: string;
  assignedTenantId?: string;
  assignedTenantIds?: string[];
}

export interface SystemSettings {
  id: string;
  tenantId: string;
  multiBranchMode: boolean;
  allowBackdating: boolean;
  requireManagerOverride: boolean;
  taxRate: number;
  taxEngineEnabled: boolean;
  deploymentMode: 'Cloud' | 'On-Premise';
  currency: string;
  updatedAt: string;
  updatedBy: string;
  tin?: string;
  branding: {
    companyName: string;
    tin?: string;
    ndaRegNumber: string;
    receiptFooter: string;
    logoUrl?: string;
  };
  operationalConfig?: {
    allowNegativeStock: boolean;
    requireBatchSelection: boolean;
    autoGenerateSKU: boolean;
    defaultTaxRate: number;
    receiptHeader: string;
    pos?: any;
    hr?: any;
    qa?: any;
    finance?: any;
    inventory?: {
      consumptionThresholds: {
        fast: number;
        moderate: number;
        slow: number;
      };
      expiryAlertWindows?: number[];
      safetyStockDays?: number;
      defaultLookbackPeriodMonths?: number;
      leadTimeFallbackDays?: number;
      allowNegativeStock?: boolean;
      requireBatchSelection?: boolean;
      autoGenerateSKU?: boolean;
      defaultTaxRate?: number;
      receiptHeader?: string;
    };
    predictive?: any;
    logistics?: any;
  };
  featureToggles?: {
    enableLoyalty: boolean;
    enableInsurance: boolean;
    enableMultiBranch: boolean;
    enableOperationalInventory: boolean;
    enableTelepharmacy: boolean;
    enablePredictiveAnalytics: boolean;
    enableWelfarePortal: boolean;
    enableTaxEngine: boolean;
  };
  numberingFormats?: {
    [key: string]: string;
  };
}

export interface AuditLog {
  id: string;
  tenantId: string;
  userId: string;
  user_id?: string;
  userName: string;
  userRole: string;
  module: string;
  actionType: string;
  action?: string;
  objectAffected: string;
  objectId: string;
  timestamp: string;
  details?: string;
  metadata?: any;
  receipt_id?: string;
}

export interface GlobalAuditLog extends AuditLog {}

export interface PendingActivation {
  id: string;
  tenantId: string;
  staffId: string;
  name: string;
  role: string;
  status: 'pending' | 'activated' | 'rejected';
  requestedAt: string;
  activatedAt?: string;
  activatedBy?: string;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'down';
  lastChecked: string;
  services: {
    database: boolean;
    auth: boolean;
    storage: boolean;
  };
}

export interface MasterRegistry {
  id: string;
  tenantId: string;
  type: string;
  name: string;
  data: any;
}

export interface Product {
  id: string;
  tenantId: string;
  productId: string;
  sku: string;
  name: string;
  category: string;
  costPricePerPack: number;
  sellingPricePerUnit: number;
  taxExempt: boolean;
  taxRate: number;
  genericName?: string;
  dosageForm?: string;
  strength?: string;
  routeOfAdministration?: string;
  prescriptionCategory?: string;
  countryOfManufacture?: string;
  ndaRegistrationNumber?: string;
  vatClassification?: 'Standard Rated' | 'Zero-Rated' | 'Exempt';
  vatPercentage?: number;
  unitsPerPack: number;
  unit: string;
  baseUnit: string;
  unitsPerStrip?: number;
  volumeWeight?: number;
  volumeWeightUnit?: string;
  volumeInMl?: number;
  manufacturingCompany?: string;
  manufacturer?: string;
  unitOfSell?: string;
  stock?: number;
  quantityInStock?: number;
}

export interface ProductBatch {
  id: string;
  tenantId: string;
  productId: string;
  branchId: string;
  quantity: number;
  expiryDate: string;
  batchNumber: string;
  purchasePrice: number;
  sellingPrice: number;
  supplier?: string;
  supplierName?: string;
  batch_status: 'active' | 'quarantined' | 'expired' | 'in_transit';
  lastUpdated?: string;
}

export interface InventoryMovement {
  id: string;
  tenantId: string;
  branchId: string;
  productId: string;
  batchId: string;
  timestamp: string;
  reference: string; // receipt, invoice number in/out, adjustment id
  movementClass: 'sale' | 'transfer out' | 'transfer in' | 'adjustment';
  class?: string; // for backward compatibility
  type?: 'in' | 'out';
  initiator: string; // name
  initiatorId?: string;
  receiver: string; // name (unclassified for walkins, branch name for transfers)
  receiverId?: string;
  amount: number; // quantity moved
  amountAttached: number; // cost or selling price
  batchNumber?: string;
  notes?: string;
}

export interface InventoryMovementEvent {
  id?: string;
  tenantId: string;
  branchId: string;
  productId: string;

  eventId: string;
  eventType:
    | 'SALE'
    | 'DISPENSING'
    | 'SALE_REVERSAL'
    | 'RETURN_TO_STOCK'
    | 'TRANSFER_IN'
    | 'TRANSFER_OUT'
    | 'WRITE_OFF'
    | 'EXPIRY'
    | 'DAMAGE'
    | 'POSITIVE_ADJUSTMENT'
    | 'NEGATIVE_ADJUSTMENT'
    | 'STOCKOUT_START'
    | 'STOCKOUT_END';

  quantityDeltaBaseUnits: number;
  consumptionDeltaBaseUnits: number;

  isExceptional: boolean;
  exceptionalReason: string | null;

  sourceCollection: string;
  sourceDocumentId: string;
  sourceLineId: string | null;
  reversalOfEventId: string | null;

  effectiveAt: any; // Firestore Timestamp
  dateKey: string;

  createdBy: string;
  createdAt: any; // Firestore Timestamp
}

export interface BranchConsumptionDaily {
  id?: string;
  tenantId: string;
  branchId: string;
  productId: string;
  dateKey: string; // YYYY-MM-DD

  baseUnitId?: string;
  baseUnitName?: string;

  openingUsableStock: number | null;
  closingUsableStock: number | null;

  ordinaryUnitsSold: number;
  ordinaryUnitsDispensed: number;
  unitsReturnedToStock: number;

  unitsTransferredIn: number;
  unitsTransferredOut: number;

  unitsWrittenOff: number;
  positiveAdjustments: number;
  negativeAdjustments: number;

  exceptionalUnits: number;
  validConsumptionUnits: number;

  transactionCount: number;
  consumptionTransactionCount: number;

  operatingMinutes: number | null;
  inStockMinutes: number | null;
  stockoutMinutes: number | null;
  wasStockedAllDay: boolean | null;

  firstStockoutAt: any | null; // Firestore Timestamp
  lastRestockedAt: any | null; // Firestore Timestamp

  createdAt: any; // Firestore Timestamp
  updatedAt: any; // Firestore Timestamp
  aggregationVersion: number;
}


export interface OperationalInventory {
  id: string;
  tenantId: string;
  branchId: string;
  type: 'fixed' | 'non-fixed';
  name: string;
  unitPerPack: number;
  costPerPack: number;
  unitOfIssue: string;
  supplier: string;
  quantityInStock: number;
  uniqueId?: string;
  purchaseDate?: string;
  cost?: number;
  utilizationTime?: number;
}

export interface OperationalInventoryUsage {
  id: string;
  tenantId: string;
  branchId: string;
  inventoryId: string;
  issuedAmount: number;
  cost: number;
  timestamp: string;
  period: string;
  staffId?: string;
  staffName?: string;
}

export interface OperationalInventoryMaintenance {
  id: string;
  tenantId: string;
  branchId: string;
  inventoryId: string;
  date: string;
  cost: number;
  description: string;
  staffId?: string;
  staffName?: string;
}

export interface Sale {
  id: string;
  tenantId: string;
  branchId: string;
  receiptNumber: string;
  timestamp: string;
  items: SaleItem[];
  subtotal: number;
  tax: number;
  taxAmount?: number;
  discountAmount?: number;
  discountPercentage?: number;
  total: number;
  totalAmount?: number;
  paymentMethod: string;
  secondaryPaymentMethod?: string;
  secondaryAmount?: number;
  welfareAmount?: number;
  cashierId: string;
  clientId?: string;
  patientId?: string;
  patientName?: string;
  institutionId?: string;
  institutionName?: string;
  prescriberId?: string;
  prescriberName?: string;
  status: 'completed' | 'voided' | 'returned' | 'active';
  context?: SaleContext;
  servedBy?: string;
  isExceptionalConsumption?: boolean;
  exceptionalConsumptionReason?: string | null;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
}

export interface SaleItem {
  productId: string;
  batchId: string;
  name: string;
  productName?: string;
  quantity: number;
  unitPrice: number;
  total: number;
  subtotal?: number;
  costPrice?: number;
  isService?: boolean;
  batchNumber?: string;
  expiryDate?: string;
}

export type SaleContext = string;

export type PaymentMethodType = 'cash' | 'momo' | 'airtel' | 'card' | 'credit' | 'insurance';

export interface SaleRevision {
  id: string;
  saleId: string;
  tenantId?: string;
  timestamp: string;
  revisedBy: string;
  reason: string;
  beforeJson: string;
  afterJson: string;
}

export interface Client {
  id: string;
  tenantId: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  type: 'individual' | 'institution';
  creditLimit?: number;
  balance?: number;
  // CRM Marketing Extensions (M3 Update)
  sms_opt_in?: boolean;
  sms_opt_in_date?: string;
  sms_opt_in_logged_by?: string;
  preferred_channel?: 'SMS' | 'WhatsApp' | 'None';
  segment_tags?: string[];
  next_refill_due_date?: string;
  referred_by_activity?: string;
  referred_by_kol_id?: string;
  loyalty_points?: number;
}

export interface InstitutionRegistry {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  contactPerson: string;
  phone: string;
  email: string;
  tin?: string;
  whtExempt?: boolean;
  discountRate?: number;
}

export interface Prescriber {
  id: string;
  tenantId: string;
  name: string;
  licenseNumber: string;
  facility: string;
  // Prescriber Rewards & KOL Layer (Pillar 4 & Pillar 6)
  isEnrolledInRewardProgram?: boolean;
  isKOL?: boolean;
  keyOpinionLeaderCategory?: 'Doctor' | 'Health Influencer' | 'Community Leader' | 'Corporate HR' | 'Other';
  contactDetails?: string;
  associatedInstitution?: string;
  monthlyPrescriptions?: number;
}

export interface FinanceLedger {
  id: string;
  tenantId: string;
  branch_id: string;
  transaction_date: string;
  entry_type: 'debit' | 'credit';
  account_category: string;
  account_name: string;
  amount_ugx: number;
  description: string;
  reference_id: string;
  reference_type: string;
  logged_by: string;
  created_at: string;
}

export interface EODReconciliation {
  id: string;
  tenantId: string;
  branch_id: string;
  reconciliation_date: string;
  cashier_id: string;
  
  cash_expected: number;
  cash_actual: number;
  cash_variance: number;

  momo_expected: number;
  momo_actual: number;
  momo_variance: number;

  airtel_expected: number;
  airtel_actual: number;
  airtel_variance: number;

  card_expected: number;
  card_actual: number;
  card_variance: number;

  insurance_expected: number;
  insurance_actual: number;
  insurance_variance: number;

  institutional_credit_expected: number;
  institutional_credit_actual: number;
  institutional_credit_variance: number;

  staff_welfare_expected: number;
  staff_welfare_actual: number;
  staff_welfare_variance: number;

  total_expected: number;
  total_actual: number;
  total_variance: number;

  variance_reason?: string;
  logged_by?: string;
  created_at?: string;
  status: 'draft' | 'submitted' | 'verified' | 'flagged' | 'Pending' | 'Approved' | 'Rejected';
}

export interface BranchExpense {
  id: string;
  tenantId: string;
  branch_id: string;
  expense_date: string;
  category: string;
  amount_ugx: number;
  description: string;
  payment_method?: 'Cash' | 'Petty Cash' | 'Bank' | string;
  logged_by?: string;
  created_at?: string;
  status: 'pending' | 'approved' | 'rejected' | 'Pending' | 'Approved' | 'Rejected';
}

export interface CashRequisition {
  id: string;
  tenantId: string;
  branch_id: string;
  requisition_date: string;
  amount_requested: number;
  status: 'pending' | 'approved' | 'rejected' | 'disbursed';
}

export interface CreditReceivable {
  id: string;
  tenantId: string;
  receipt_id: string;
  client_id?: string;
  client_name?: string;
  institution_id?: string;
  amount_ugx: number;
  outstanding_ugx: number;
  status: 'outstanding' | 'paid' | 'defaulted';
  branch_id?: string;
  due_date?: string;
  invoice_number?: string;
  created_at?: string;
}

export interface SupplierPayable {
  id: string;
  tenantId: string;
  supplier_id: string;
  supplier_name?: string;
  amount_ugx: number;
  outstanding_ugx?: number;
  status: 'pending' | 'paid';
  due_date?: string;
  notes?: string;
  created_at?: string;
}

export interface ManagementExpense {
  id: string;
  tenantId: string;
  date: string;
  expense_date?: string;
  category: string;
  amount: number;
  amount_ugx?: number;
  status?: string;
  created_at?: string;
  logged_by?: string;
  description?: string;
  department?: string;
}

export interface ProcurementInvoice {
  id: string;
  tenantId: string;
  branch_id: string;
  branch_name?: string;
  supplier_id: string;
  supplier_name: string;
  invoice_number: string;
  grn_number?: string;
  invoice_date: string;
  due_date: string;
  amount: number;
  total_amount_ugx: number;
  paid_amount_ugx: number;
  status: 'Paid' | 'Credit' | 'Partial' | 'pending';
  created_at: string;
}

export interface MarketingCampaign {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  category?: 'Digital Content' | 'Media' | 'Events and Partnerships' | 'Prescriber Engagement' | 'Client Programme' | 'Seminars' | 'Print' | 'Community Outreach';
  description?: string;
  startDate: string;
  endDate: string;
  start_date?: string;
  end_date?: string;
  status: string; // 'planned' | 'active' | 'completed' | 'cancelled'
  responsible_staff?: string;
  budget: number;
  actualCost?: number;
  actual_cost?: number;
  costCategory?: string;
  cost_category?: string;
  roi: number;
  impact_metrics?: {
    social_reach?: number;
    attendance?: number;
    new_clients?: number;
    estimated_audience?: number;
    prescriptions_referred?: number;
    points_redemptions?: number;
    revenue_referred?: number;
  };
  community_area?: string; // Geographic Area Name
  tagged_product_ids?: string[];
  dispensed_products?: { productId: string; quantity: number }[]; // For Community Outreach linked items
}

export interface CustomerFeedback {
  id: string;
  tenantId: string;
  clientId?: string;
  client_id?: string;
  patient_name?: string;
  patientName?: string;
  rating: number; // 1-5 stars
  comments?: string;
  comment?: string;
  date: string;
  npsScore?: 'Yes' | 'Neutral' | 'No';
  feedbackSource?: 'Internal POS' | 'External Google' | 'External Facebook' | 'External Other';
  reviewResponse?: string;
}

// Pillar 2 (Consent & Nudges) Message Interfaces
export interface HealthMessage {
  id: string;
  tenantId: string;
  title: string;
  body: string;
  targetSegmentTags: string[];
  plannedSendDate: string;
  status: 'Draft' | 'Approved' | 'Sent';
  createdBy?: string;
}

export interface MessageQueueItem {
  id: string;
  tenantId: string;
  recipientName: string;
  clientId: string;
  channel: 'SMS' | 'WhatsApp' | 'None';
  messagePreview: string;
  scheduledDate: string;
  status: 'Pending' | 'Sent' | 'Delivered' | 'Failed' | 'Opted Out';
}

// Pillar 3 Loyalty structures
export interface PharmPointsSettings {
  id: string;
  tenantId: string;
  earningRatio: number; // Default 1000 UGX = 1 point
  redemptionValue: number; // Default 1 point = 10 UGX
  minimumRedemptionThreshold: number; // Default 50 points
  maximumRedemptionCapPercent: number; // Default 20%
  pointsExpiryPeriodMonths: number; // Default 24 months
  refillReminderBufferDays: number; // Default 3 days
}

export interface PharmPointsTransaction {
  id: string;
  tenantId: string;
  clientId: string;
  clientName: string;
  type: 'earn' | 'redeem' | 'expire';
  points: number;
  equivalentUgx: number;
  receiptNumber?: string;
  date: string;
}

export interface PlatformAuditLog {
  id: string;
  userId: string;
  action: string;
  timestamp: string;
}

export interface StockOrder {
  id: string;
  tenantId: string;
  order_number: string;
  requesting_branch_id: string;
  requesting_branch_name?: string;
  order_type: 'monthly' | 'weekly' | 'emergency';
  category: 'sellable_non_cosmetic' | 'sellable_cosmetic' | 'non_sellable';
  generation_method: 'manual' | 'auto_generated';
  status: 'draft' | 'submitted' | 'in_triage' | 'sourcing' | 'awaiting_finance_approval' | 'approved' | 'dispatched' | 'fully_received' | 'closed';
  total_order_value_ugx: number;
  is_emergency: boolean;
  created_at: string;
  created_by: string;
  submitted_at?: string;
  approved_at?: string;
  approved_by?: string;
  notes?: string;
}

export interface StockOrderLine {
  id: string;
  tenantId: string;
  order_id: string;
  product_id: string;
  product_name: string;
  qty_ordered: number;
  qty_supplied?: number;
  unit_cost_ugx: number;
  quoted_price_ugx?: number;
  line_total_ugx: number;
  line_status: 'pending' | 'sourcing' | 'unsupplied' | 'awaiting_finance_approval' | 'approved' | 'dispatched' | 'received' | 'queried' | 'deferred' | 'rejected';
  supplier_id?: string;
  supplier_name?: string;
  supplier_type?: 'external' | 'internal_hq' | 'internal_warehouse';
  original_qty?: number;
  notes?: string;
  isOperational?: boolean;
}

export interface GRNRecord {
  id: string;
  tenantId: string;
  grn_number: string;
  order_id?: string;
  supplier_id: string;
  supplier_name?: string;
  invoice_number?: string;
  invoice_date?: string;
  receivedAt: string;
  receivedBy: string;
  status: 'draft' | 'completed' | 'verified';
  payment_type?: 'cash' | 'credit';
  payment_status?: 'pending' | 'paid';
  total_value_ugx: number;
  inputVat?: number;
  whtAmount?: number;
  items: GRNLine[];
  notes?: string;
}

export interface GRNLine {
  product_id: string;
  product_name: string;
  qty_ordered: number;
  qty_received: number;
  unit_cost_ugx: number;
  total_cost_ugx: number;
  batch_number?: string;
  expiry_date?: string;
  status: 'received' | 'queried';
  query_reason?: string;
}

export interface UnsuppliedLine {
  id: string;
  tenantId: string;
  order_id: string;
  original_line_id?: string;
  product_id: string;
  product_name: string;
  qty_unsupplied: number;
  reason: string;
  status: 'pending' | 'deferred' | 're-ordered';
  deferred_reason?: string;
  createdAt: string;
}

export interface CreditLedgerEntry {
  id: string;
  tenantId: string;
  supplier_id: string;
  supplier_name: string;
  amount_ugx: number;
  reference_type: 'GRN' | 'Payment';
  reference_id: string;
  date: string;
  status: 'pending' | 'reconciled';
  notes?: string;
}

export interface TransferInvoice {
  id: string;
  tenantId: string;
  transfer_number: string;
  source_branch_id: string;
  source_branch_name?: string;
  destination_branch_id: string;
  destination_branch_name?: string;
  transfer_type: 'branch_to_branch' | 'central_to_branch' | 'branch_to_central' | 'query_return';
  status: 'draft' | 'dispatched' | 'received' | 'cancelled' | 'fully_accepted' | 'queried';
  dispatched_by: string;
  dispatched_at: string;
  received_by?: string;
  received_at?: string;
  total_value_ugx: number;
  notes?: string;
  items: TransferInvoiceLine[];
}

export interface TransferInvoiceLine {
  id: string;
  tenantId: string;
  transfer_id: string;
  product_id: string;
  product_name: string;
  qty_dispatched: number;
  qty_received?: number;
  qty_accepted?: number;
  qty_queried?: number;
  query_reason?: string;
  line_status?: 'dispatched' | 'received' | 'returned';
  unit_cost_ugx: number;
  total_cost_ugx: number;
  batch_number?: string;
  expiry_date?: string;
  updatedAt?: string;
  createdAt?: string;
}

export interface WelfareRecord {
  id: string;
  tenantId: string;
  staffId: string;
  type: string;
  amount: number;
}

export interface CSRProject {
  id: string;
  tenantId: string;
  name: string;
  budget: number;
}

export interface AdvanceRequest {
  id: string;
  tenantId: string;
  staffId: string;
  staff_id?: string;
  staff_name?: string;
  amount: number;
  amount_requested?: number;
  amountRequested?: number;
  status: string;
  created_at?: string;
  reason?: string;
  repaymentMethod?: string;
  repayment_period_months?: number;
  hr_approval_status?: string;
  ceo_approval_status?: string;
  submittedAt?: string;
}

export interface AppraisalScore {
  id: string;
  staffId: string;
  score: number;
  period: string;
  date?: string;
}

export interface Appraisal {
  id: string;
  staffId: string;
  staffName?: string;
  date: string;
  branchId?: string;
  tenantId?: string;
  theoreticalScore?: number;
  practiceScore?: number;
  cmePoints?: number;
  overallScore?: number;
  ratingBand?: string;
  strengths?: string | string[];
  improvements?: string | string[];
  goals?: string | string[];
  appraiserName?: string;
  status?: string;
  period?: string; // 'Q1', 'Q2', 'Q3', 'Q4', 'Annual'
  year?: string; // e.g., '2026'
  cmeMaxPoints?: number; // 98 (quarterly) or 390 (annual)
  cmePercentage?: number;
  hrRecommendedAction?: string; // 'Bonus' | 'Promotion' | 'Recognition' | etc.
  managerLoggedBy?: string;
  managerLoggedAt?: string;
  qaLoggedBy?: string;
  qaLoggedAt?: string;
  cappedThresholdAlert?: boolean;
}

export interface CMERecord {
  id: string;
  staffId: string;
  topic: string;
  date: string;
}

export interface CMESession {
  id: string;
  topic: string;
  date: string;
  branchId?: string;
  tenantId?: string;
  presenter?: string;
  durationMinutes?: number;
  cmeId?: string;
  presenterType?: string;
  sessionType?: string;
  attendees?: string[];
  attendancePoints?: number;
  presenterPoints?: number;
  notes?: string;
  status?: string;
  venue?: string;
  uploadedMaterials?: string[];
  attendeeScores?: {
    staffId: string;
    staffName: string;
    role: string;
    basePoints: number;
    punctualityPoints: number;
    engagementPoints: number;
    totalPoints: number;
    punctualityTier: string;
    engagement: boolean;
    isPresenter: boolean;
  }[];
}

export interface LeaveRequest {
  id: string;
  tenantId: string;
  staffId: string;
  staff_id?: string;
  staff_name?: string;
  startDate: string;
  endDate: string;
  start_date?: string;
  end_date?: string;
  status: string;
  created_at?: string;
  leave_type?: string;
  total_days?: number;
  reason?: string;
  attachment_url?: string;
  hr_approval_status?: string;
  ceo_approval_status?: string;
}

export interface Payslip {
  id: string;
  tenantId?: string;
  staffId: string;
  month: string;
  year: number;
  pdfUrl?: string;
  netPayable: number;
  basePay: number;
  deductions: number;
}

export interface AttendanceRecord {
  id: string;
  staffId: string;
  tenantId?: string;
  date: string;
  status: string;
  check_in_time?: string | null;
  check_out_time?: string | null;
  hours_worked?: number;
  branch_id?: string;
  staff_name?: string;
}

export interface DisciplinaryIncident {
  id: string;
  staffId: string;
  category: string;
  date: string;
}

export interface HiringApplication {
  id: string;
  tenantId?: string;
  full_name: string;
  fullName?: string; // compatible
  email: string;
  phone: string;
  position_applied: string;
  position_applied_for?: string; // compatible
  applied_at: string;
  status: string; // 'applied' | 'theoretical_scheduled' | 'theoretical_completed' | 'oral_scheduled' | 'oral_completed' | 'practical_scheduled' | 'practical_completed' | 'recommended_training' | 'training_accepted' | 'hired' | 'rejected'
  education_level?: string;
  experience_years?: number;
  
  // Marks and Timetables
  theory_score?: number | null;
  theory_date?: string | null;
  oral_score?: number | null;
  oral_date?: string | null;
  practical_score?: number | null;
  practical_date?: string | null;

  // Trainee appraisals & assessments
  week4_appraisal_score?: number | null;
  week4_theory_score?: number | null;
  week4_assessment_date?: string | null;
  
  week8_appraisal_score?: number | null;
  week8_theory_score?: number | null;
  week8_assessment_date?: string | null;
  
  week12_appraisal_score?: number | null;
  week12_theory_score?: number | null;
  week12_assessment_date?: string | null;
  
  training_recommended_date?: string | null;
  training_accepted_date?: string | null;
  training_completed_date?: string | null;
}

export interface TheoryTest {
  id: string;
  applicationId: string;
  score: number;
  date?: string;
  result?: string;
}

export interface OralInterview {
  id: string;
  applicationId: string;
  score: number;
  rating?: number;
  outcome?: string;
}

export interface PracticalAssessment {
  id: string;
  applicationId: string;
  status: string;
  score?: number;
  result?: string;
}

export interface PettyCashLedger {
  id: string;
  tenantId: string;
  date: string;
  amount: number;
  source: string;
  reference_number: string;
  type: 'incoming' | 'outgoing';
  branch_id?: string;
  logged_by: string;
  created_at: string;
}

export interface PettyCashRequisition {
  id: string;
  tenantId: string;
  branch_id: string;
  branch_name: string;
  requisition_date: string;
  amount_requested: number;
  reason: string;
  status: 'pending' | 'finance_approved' | 'ceo_approved' | 'approved' | 'rejected' | 'issued' | 'received';
  finance_approval_by?: string;
  finance_approval_at?: string;
  ceo_approval_by?: string;
  ceo_approval_at?: string;
  disbursed_at?: string;
  disbursed_by?: string;
}

export interface PettyCashIssue {
  id: string;
  tenantId: string;
  requisition_id: string;
  branch_id: string;
  branch_name: string;
  amount: number;
  issue_date: string;
  reference_number: string;
  status: 'pending' | 'completed' | 'received';
  issued_by: string;
  issued_at: string;
  received_by?: string;
  received_at?: string;
  notes?: string;
}

export interface BranchPettyCashExpense {
  id: string;
  tenantId: string;
  branch_id: string;
  date: string;
  category: string;
  amount: number;
  description: string;
  logged_by: string;
  created_at: string;
}

export interface FuelLog {
  id: string;
  vehicleId: string;
  amount: number;
}

export interface MaintenanceLog {
  id: string;
  vehicleId: string;
  cost: number;
}

export interface TrafficFineLog {
  id: string;
  vehicleId: string;
  amount: number;
}

export interface Trip {
  id: string;
  vehicleId: string;
  status: string;
}

export interface TripLeg {
  id: string;
  tripId: string;
}

export interface Vehicle {
  id: string;
  name: string;
  numberPlate: string;
}

export interface CleaningTask {
  id: string;
  name: string;
  branchId?: string;
  taskName?: string;
  frequency?: string;
  responsibleRole?: string;
}

export interface CleaningLogEntry {
  id: string;
  taskId: string;
  taskName?: string;
  date: string;
  branchId?: string;
  dateCompleted?: string;
  timeCompleted?: string;
  tenantId?: string;
  completedBy?: string;
  status?: string;
  notes?: string;
}

export interface ControlledDrugEntry {
  id: string;
  productId: string;
  branchId?: string;
  timestamp?: string;
  tenantId?: string;
  transactionRef?: string;
  drugName?: string;
  dosageForm?: string;
  strength?: string;
  batchNumber?: string;
  quantity?: number;
  runningBalance?: number;
  entryType?: 'In' | 'Out';
  reasonCode?: string;
  authorisedBy?: string;
  movementId?: string;
}

export interface ExpiryLogEntry {
  id: string;
  productId: string;
  branchId?: string;
  expiryDate?: string;
  productName?: string;
  batchNumber?: string;
  sohUnits?: number;
}

export interface QuarantineLogEntry {
  id: string;
  productId: string;
  branchId?: string;
  dateQuarantined?: string;
  tenantId?: string;
  quarantineId?: string;
  productName?: string;
  batchNumber?: string;
  quantity?: number;
  reason?: string;
  quarantinedBy?: string;
  notes?: string;
  currentLocation?: string;
  status?: string;
}

export interface PremisesLicense {
  id: string;
  name: string;
  branchId?: string;
  expiryDate?: string;
  tenantId?: string;
  issuingAuthority?: string;
  licenseType?: string;
  licenseNumber?: string;
  status?: string;
}

export interface PersonnelLicense {
  id: string;
  staffId: string;
  expiryDate?: string;
  tenantId?: string;
  staffName?: string;
  licenseType?: string;
  licenseNumber?: string;
  status?: string;
}

export interface Recall {
  id: string;
  productId: string;
  dateInitiated?: string;
  tenantId?: string;
  productName?: string;
  batchNumber?: string;
  quantityAffected?: number;
  recallId?: string;
  totalCost?: number;
  recallType?: string;
  recallClass?: string;
  source?: string;
  reason?: string;
  costPerUnit?: number;
  initiatedBy?: string;
  status?: string;
  retentionUntil?: string;
}

export interface RoomTempLogEntry {
  id: string;
  date: string;
  branchId?: string;
  time?: string;
  tenantId?: string;
  location?: string;
  temperature?: number;
  humidity?: number;
  recordedBy?: string;
  notes?: string;
  isOutOfRange?: boolean;
}

export interface FridgeTempLogEntry {
  id: string;
  date: string;
  branchId?: string;
  tenantId?: string;
  readingPeriod?: string;
  fridgeId?: string;
  temperature?: number;
  humidity?: number;
  recordedBy?: string;
  notes?: string;
  isOutOfRange?: boolean;
  excursionProtocolTriggered?: boolean;
  affectedProductsConfirmed?: boolean;
}

export interface BillableService {
  id: string;
  name: string;
  price: number;
  defaultFee?: number;
}

export interface ReplenishmentEngineSettings {
  tenantId: string;
  defaultLookbackDays: number;
  defaultCoverageDays: number;
  defaultLeadTimeDays: number;
  defaultSafetyDays: number;
  trendWeight: number;
  trendMinimumMultiplier: number;
  trendMaximumMultiplier: number;
  stockoutAdjustmentCap: number;
  minimumValidHistoryDays: number;
  seasonalityEnabled: boolean;
  seasonalityMinimumMonths: number;
  currentPeriodWeight: number;
  historicalPeriodWeight: number;
  observedLeadTimeDeliveryCount: number;
  minimumLeadTimeObservations: number;
  leadTimeMethod: 'MANUAL' | 'OBSERVED_MEDIAN' | 'HIGHER_OF_MANUAL_AND_OBSERVED' | 'TENANT_DEFAULT';
  confidenceHighThreshold: number;
  confidenceModerateThreshold: number;
  updatedAt?: string;
  updatedBy?: string;
}

export interface ForecastCalculationInput {
  tenantId: string;
  branchId: string;
  productId?: string;
  productIds?: string[];
  analysisStartDate: string;
  analysisEndDate: string;
  forecastCoverageDays: number;
  leadTimeMethod?: string;
  manualLeadTimeOverrideDays?: number | null;
  safetyPolicy?: string;
  safetyDaysOverride?: number | null;
  includeExceptionalConsumption: boolean;
  temporaryDemandMultiplier?: number | null;
  useSeasonality: boolean;
}

export interface ForecastCalculationOutput {
  tenantId: string;
  branchId: string;
  productId: string;
  analysisPeriod: {
    startDate: string;
    endDate: string;
    totalDays: number;
    validStockedDays: number;
  };
  actualConsumption: number;
  adjustedConsumption: number;
  adc: number;
  earlierHalfAdc: number;
  recentHalfAdc: number;
  trendMultiplier: number;
  seasonalityStatus: string;
  projectedDailyConsumption: number;
  projectedConsumption: number;
  effectiveLeadTimeDays: number;
  leadTimeSource: string;
  leadTimeStock: number;
  effectiveSafetyDays: number;
  safetyBuffer: number;
  targetStockLevel: number;
  expiryAdjustedUsableStock: number;
  confirmedIncoming: number;
  grossNetRequirement: number;
  confidenceScore: number;
  confidenceLabel: string;
  calculationAllowed: boolean;
  manualReviewReasons: string[];
  warnings: string[];
}

export interface BranchReplenishmentSnapshot {
  id?: string;
  tenantId: string;
  branchId: string;
  productId: string;
  calculatedAt: string;
  dataVersion: number;
  projectedDailyConsumption: number;
  projectedConsumption: number;
  leadTimeStock: number;
  safetyBuffer: number;
  protectedRequirement: number;
  expiryAdjustedUsableStock: number;
  confirmedOutboundCommitments: number;
  transferableExcess: number;
  confidenceScore: number;
  staleAfter: string;
}

export interface InventoryTransferReservation {
  id?: string;
  tenantId: string;
  sourceBranchId: string;
  destinationBranchId: string;
  productId: string;
  batchId: string | null;
  autoGenerateRunId: string;
  requestedQuantityBaseUnits: number;
  reservedQuantityBaseUnits: number;
  status: 'PENDING' | 'ACTIVE' | 'CONVERTED' | 'RELEASED' | 'EXPIRED' | 'CANCELLED';
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  convertedTransferRequestId: string | null;
}

export interface AutoGenerateOrderRun {
  id?: string;
  tenantId: string;
  runId: string;
  branchId: string;
  status: 'CALCULATING' | 'READY' | 'DRAFT' | 'SUBMITTING' | 'SUBMITTED' | 'PARTIALLY_SUBMITTED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
  configuration: {
    analysisStartDate: string;
    analysisEndDate: string;
    forecastCoverageDays: number;
    requiredDeliveryDate: string;
    safetyPolicy: string;
    leadTimeMethod: string;
    checkCentralStore: boolean;
    checkOtherBranches: boolean;
    includeExceptionalConsumption: boolean;
    applySeasonality: boolean;
    budgetCeiling?: number | null;
    temporaryDemandMultiplier?: number | null;
  };
  calculationVersion: number;
  productCountAnalysed: number;
  externalLineCount: number;
  internalLineCount: number;
  manualReviewCount: number;
  generatedBy: string;
  generatedAt: string;
  updatedAt: string;
  submissionIdempotencyKey: string | null;
  submittedAt: string | null;
}

export interface AutoGenerateOrderLine {
  id?: string;
  tenantId: string;
  runId: string;
  productId: string;
  productName: string;
  sku: string;
  genericName: string;
  dosageForm?: string;
  baseUnit: string;
  purchasePack: string;
  unitsPerPack: number;
  venClass?: string;
  movementClass?: string;
  
  // Original outputs
  originalRecommendationBaseUnits: number;
  originalPurchasePacks: number;
  originalInternalAllocation: number;
  originalCentralAllocation: number;
  originalDonorAllocations: { branchId: string; qtyBaseUnits: number }[];

  // Final outputs
  finalRecommendationBaseUnits: number;
  finalPurchasePacks: number;
  finalInternalAllocation: number;
  finalCentralAllocation: number;
  finalDonorAllocations: { branchId: string; qtyBaseUnits: number }[];

  calculationInputs: any;
  calculationOutputs: any;
  confidenceScore: number;
  warnings: string[];
  explanation: string;

  wasOverridden: boolean;
  overrideReason: string | null;
  overriddenBy: string | null;
  overriddenAt: string | null;
  isManualAdd?: boolean;
}
