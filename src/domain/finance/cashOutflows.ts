import { isBusinessDate, kampalaBusinessDate, timestampBusinessDate } from '../../utils/eodBusinessDate';

export const LOGISTICS_EXPENSE_COLLECTIONS = ['fuel_logs', 'maintenance_logs', 'traffic_fine_logs', 'logistics_expenses'] as const;
type LedgerCollection = 'petty_cash_ledger' | 'banking_records';

export type CashOutflowEvidence = Record<string, unknown> & { id: string };
export type CashMovementEvidence = CashOutflowEvidence & { collection: LedgerCollection };

export type CashOutflow = {
  id: string;
  tenantId: string;
  date: string;
  amount: number;
  description: string;
  category: string;
  reference: string;
  displayReference: string;
  postedByName: string;
  accountId: string;
  accountName: string;
  portfolioId: string;
  branchId: string;
  actorId: string;
  sourceCollection: string;
  sourceId: string;
  status: 'posted' | 'unverified';
};

const str = (value: unknown) => typeof value === 'string' ? value : '';
const internalSources = new Set(['Management portfolio transfer', 'Management bank transfer',
  'Portfolio transfer debit', 'Portfolio transfer credit', 'Petty Cash Reserve']);

function businessDate(value: unknown): string {
  if (typeof value === 'string') return isBusinessDate(value) ? value : timestampBusinessDate(value) ?? '';
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && Number.isFinite(date.getTime()) ? kampalaBusinessDate(date) : '';
  }
  return '';
}

export function collectCashOutflows(input: {
  tenantId: string;
  accounts: CashOutflowEvidence[];
  movements: CashMovementEvidence[];
  supplierPayments: CashOutflowEvidence[];
  creditPayments: CashOutflowEvidence[];
  managementExpenses?: CashOutflowEvidence[];
  staff?: CashOutflowEvidence[];
}): CashOutflow[] {
  const { tenantId } = input;
  const index = (rows: CashOutflowEvidence[]) => new Map(rows.filter(row => row.tenantId === tenantId).map(row => [row.id, row]));
  const accounts = index(input.accounts);
  const suppliers = index(input.supplierPayments);
  const credits = index(input.creditPayments);
  const expenses = index(input.managementExpenses ?? []);
  const staff = index(input.staff ?? []);
  const rows = new Map<string, CashOutflow>();

  for (const movement of input.movements) {
    if (movement.tenantId !== tenantId || !['outgoing', 'withdrawal'].includes(str(movement.type).toLowerCase())) continue;
    const description = str(movement.source);
    if (movement.eodReconciliationId || movement.eodChannel || movement.eodCorrectionId ||
      movement.transferId || movement.movementClass === 'transfer_out' || movement.movementClass === 'transfer_in' ||
      (!movement.externalExpenseCollection && !movement.paymentId && internalSources.has(description))) continue;

    const amount = movement.amount;
    const account = accounts.get(str(movement.accountDocumentId));
    const accountId = str(account?.accountId);
    const actorId = str(movement.postedBy);
    const scope = account?.scope as { kind?: string; branchId?: string } | undefined;
    const branchId = scope?.kind === 'branch' ? str(scope.branchId) : '';
    const portfolioId = accountId.startsWith('bank_') || accountId === 'management_bank' ? 'system_bank'
      : accountId === 'management_petty_cash' || accountId.startsWith('system_petty_cash_') ? 'system_petty_cash'
      : accountId.startsWith('system_branch_cash_sales_') ? 'system_branch_cash_sales' : str(account?.portfolioId);
    const paymentId = str(movement.paymentId);
    const supplier = suppliers.get(paymentId);
    const credit = credits.get(paymentId);
    const collection = str(movement.externalExpenseCollection);
    const expenseId = str(movement.externalExpenseId);
    let sourceCollection = '';
    let sourceId = '';
    let category = '';
    let date = businessDate(movement.date) || businessDate(movement.createdAt);
    let reference = str(movement.reference_number);
    let invoiceRef = '';
    let postedByName = '';
    let charge = false;

    if (movement.movementClass === 'transfer_charge' && movement.id === movement.portfolioTransferId + '_fee' && movement.portfolioTransferId) {
      sourceCollection = 'finance_transfers_v1';
      sourceId = str(movement.portfolioTransferId);
      category = 'Transfer fee';
    } else if (movement.supplierPosting === 'cash' || movement.supplierPosting === 'credit') {
      const isCredit = movement.supplierPosting === 'credit';
      const payment = isCredit ? credit : supplier;
      charge = movement.supplierCharge === true;
      const movementId = isCredit ? 'credit_payment_' + paymentId : paymentId;
      if (payment && payment.status !== 'posted') continue;
      if (payment && payment.movementId === movementId &&
        (charge ? movement.id === movementId + '_fee' && payment.chargeMovementId === movement.id &&
          payment.chargeUGX === amount && movement.expenseCategory === 'Financial service expenses'
          : movement.supplierCharge === false && movement.id === movementId && (isCredit ? payment.amount : payment.amountUGX) === amount) &&
        payment.processedBy === actorId && payment.paymentAccountId === accountId && movement.paymentAccountId === accountId &&
        payment.paymentAccountKind === account?.kind && payment.fundingBranchId === branchId && movement.fundingBranchId === branchId &&
        payment.externalReference === movement.externalReference && payment.invoiceId === movement.invoiceId &&
        payment.grnId === movement.grnId && (!isCredit || payment.creditLedgerId === movement.creditLedgerId)) {
        sourceCollection = isCredit ? 'creditPayments' : 'cash_grn_payments';
        sourceId = paymentId;
        category = charge ? 'Financial service expenses' : isCredit ? 'Supplier credit payment' : 'Supplier invoice payment';
        postedByName = str(payment.processedByName);
        invoiceRef = str(payment.invoiceRef);
        reference = str(payment.externalReference) || reference;
        date = businessDate(payment.processedAt) || date;
      }
    } else if (!movement.portfolioTransferId && !movement.movementClass) {
      if (supplier && movement.id === paymentId && supplier.amountUGX === amount &&
        supplier.processedBy === actorId && supplier.paymentAccountId === accountId &&
        supplier.invoiceId === movement.invoiceId && supplier.grnId === movement.grnId) {
        sourceCollection = 'cash_grn_payments';
        sourceId = paymentId;
        category = 'Supplier invoice payment';
        postedByName = str(supplier.processedByName);
        reference = str(supplier.externalReference) || reference;
        date = businessDate(supplier.processedAt) || date;
      } else if (credit && movement.id === 'credit_payment_' + paymentId && credit.amount === amount &&
        credit.processedBy === actorId && accountId === 'management_petty_cash' &&
        credit.invoiceId === movement.invoiceId && credit.creditLedgerId === movement.creditLedgerId) {
        sourceCollection = 'creditPayments';
        sourceId = paymentId;
        category = 'Supplier credit payment';
        invoiceRef = str(credit.invoiceRef);
        reference = str(credit.paymentReference) || reference;
        date = businessDate(credit.processedAt) || date;
      } else if (expenseId && movement.id === 'expense_payment_' + expenseId &&
        ((collection === 'branch_expenses' && branchId && movement.branchId === branchId && accountId === 'system_petty_cash_' + branchId) ||
         (collection === 'management_expenses' && accountId === 'management_petty_cash'))) {
        sourceCollection = collection;
        sourceId = expenseId;
        const expense = collection === 'management_expenses' ? expenses.get(expenseId) : undefined;
        category = expense?.source === 'credit_payment' ? 'Supplier credit payment'
          : str(movement.expenseCategory) || (branchId ? 'Branch expense' : 'Management expense');
        invoiceRef = str(expense?.invoiceRef);
        postedByName = str(expense?.issuedBy);
      } else if (expenseId && movement.id === 'logistics_payment_' + expenseId && accountId === 'management_petty_cash' &&
        LOGISTICS_EXPENSE_COLLECTIONS.some(source => source === collection)) {
        sourceCollection = collection;
        sourceId = expenseId;
        category = 'Logistics';
      }
    }

    const validAmount = typeof amount === 'number' && Number.isSafeInteger(amount) && amount > 0;
    const verified = !!(sourceCollection && sourceId && validAmount && date && actorId && portfolioId &&
      account?.id === tenantId + '_' + accountId && account.initialized === true && account.currency === 'UGX' &&
      account.kind === (movement.collection === 'banking_records' ? 'bank' : 'petty_cash') &&
      movement.accountDeltaUGX === -(amount as number));
    const id = verified ? sourceCollection + '/' + sourceId + (charge ? '/fee' : '') : movement.collection + '/' + movement.id;
    const actor = staff.get(actorId);
    postedByName = [postedByName, str(actor?.full_name), str(actor?.fullName), str(movement.logged_by)]
      .map(name => name.trim())
      .find(name => name && name !== actorId && !name.includes('@') && !/^(system|authorized finance|corporate user)$/i.test(name)) || '';
    const businessReference = reference.trim();
    const displayReference = invoiceRef.trim() && invoiceRef !== sourceId ? 'Invoice ' + invoiceRef.trim()
      : businessReference && businessReference !== movement.id && businessReference !== sourceId ? businessReference
      : 'Reference unavailable';
    rows.set(id, {
      id, tenantId, date, amount: validAmount ? amount : 0, description: description || 'Ledger debit',
      category: category || 'Unverified debit', reference: reference || movement.id, displayReference, postedByName, accountId,
      accountName: str(account?.name), portfolioId, branchId, actorId,
      sourceCollection: sourceCollection || movement.collection, sourceId: sourceId || movement.id,
      status: verified ? 'posted' : 'unverified',
    });
  }
  return [...rows.values()].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
