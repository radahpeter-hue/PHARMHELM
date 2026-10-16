/**
 * Stage 2 canonical Central GRN → Finance contract.
 *
 * PURE POLICY ONLY: no stock changes, ledger writes, cash movement or dispatch.
 * The transaction services must validate and atomically materialize this plan.
 * Do not mark cash invoices Paid until the separate Finance payment transaction
 * has posted to Management Petty Cash.
 */
export type CentralGrnInventoryClass = 'SELLABLE' | 'OPERATIONAL';
export type SupplierPaymentTerms = 'cash' | 'credit';
export type OperationalAccountingClass = 'CONSUMABLE_OPERATIONAL' | 'FIXED_ASSET';

export interface FinanceGrnLine {
  orderLineId: string;
  supplierId: string;
  quantity: number;
  unitCostUGX: number;
  operationalType?: OperationalAccountingClass;
}

export interface CentralGrnFinanceInput {
  tenantId: string;
  grnId: string;
  orderId: string;
  invoiceRef: string;
  supplierId: string;
  inventoryClass: CentralGrnInventoryClass;
  paymentType: SupplierPaymentTerms;
  lines: FinanceGrnLine[];
}

export interface CentralGrnFinancePlan {
  invoiceId: string;
  invoiceStatus: 'cash_pending_payment' | 'credit_outstanding';
  paymentType: SupplierPaymentTerms;
  invoiceAmountUGX: number;
  managementPaymentDraftId: string | null;
  supplierCreditId: string | null;
  pettyCashPostingAtGrn: false;
  paymentStatus: 'Pending Payment' | 'Outstanding';
  expenseRecognition: {
    consumablesOpexUGX: number;
    fixedAssetAcquisitionUGX: number;
    sellableInventoryAcquisitionUGX: number;
  };
  dispatchStatus: 'ready_for_dispatch';
}

const safeId = (value: string): string => {
  if (!value || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) throw new Error('A valid canonical GRN identifier is required.');
  return value;
};

export function planCentralGrnFinance(input: CentralGrnFinanceInput): CentralGrnFinancePlan {
  if (!input.tenantId.trim() || !input.orderId.trim() || !input.invoiceRef.trim() || !input.supplierId.trim()) {
    throw new Error('A tenant, order, supplier and invoice reference are required.');
  }
  if (input.inventoryClass !== 'SELLABLE' && input.inventoryClass !== 'OPERATIONAL') throw new Error('Unsupported inventory class.');
  if (input.paymentType !== 'cash' && input.paymentType !== 'credit') throw new Error('Select Cash or Credit at Central GRN.');
  if (input.lines.length === 0) throw new Error('At least one received supplier product is required.');
  const id = safeId(input.grnId);
  const seen = new Set<string>();
  let amount = 0;
  let consumables = 0;
  let assets = 0;
  let sellable = 0;
  for (const line of input.lines) {
    if (!line.orderLineId || seen.has(line.orderLineId)) throw new Error('Supplier order lines must have distinct identities.');
    seen.add(line.orderLineId);
    if (line.supplierId !== input.supplierId) throw new Error('One supplier invoice cannot combine different suppliers.');
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0 ||
      !Number.isSafeInteger(line.unitCostUGX) || line.unitCostUGX <= 0) {
      throw new Error('GRN quantities and unit costs must be positive whole values.');
    }
    const value = line.quantity * line.unitCostUGX;
    if (!Number.isSafeInteger(value)) throw new Error('Invoice value exceeds the safe integer range.');
    amount += value;
    if (input.inventoryClass === 'OPERATIONAL') {
      if (line.operationalType === 'CONSUMABLE_OPERATIONAL') consumables += value;
      else if (line.operationalType === 'FIXED_ASSET') assets += value;
      else throw new Error('Operational GRN requires a valid accounting classification for every item.');
    } else {
      if (line.operationalType) throw new Error('Sellable lines cannot carry Operational expense classifications.');
      sellable += value;
    }
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Invalid supplier invoice total.');
  const cash = input.paymentType === 'cash';
  return {
    invoiceId: `procurement_invoice_${id}`,
    invoiceStatus: cash ? 'cash_pending_payment' : 'credit_outstanding',
    paymentType: input.paymentType,
    invoiceAmountUGX: amount,
    managementPaymentDraftId: cash ? `management_payment_draft_${id}` : null,
    supplierCreditId: cash ? null : `supplier_credit_${id}`,
    pettyCashPostingAtGrn: false,
    paymentStatus: cash ? 'Pending Payment' : 'Outstanding',
    expenseRecognition: {
      consumablesOpexUGX: consumables,
      fixedAssetAcquisitionUGX: assets,
      sellableInventoryAcquisitionUGX: sellable
    },
    dispatchStatus: 'ready_for_dispatch'
  };
}

/**
 * A payment is a liability settlement, not a second operational expense.
 * Stage 2 payment services must enforce this invariant in their transactions.
 */
export function assertSettlementDoesNotDuplicateExpense(plan: CentralGrnFinancePlan, proposedNewOpexUGX: number): void {
  if (proposedNewOpexUGX !== 0) {
    throw new Error('Supplier payment must not recognize procurement expense a second time.');
  }
  if (plan.pettyCashPostingAtGrn !== false) throw new Error('GRN must never debit petty cash during finalization.');
}
