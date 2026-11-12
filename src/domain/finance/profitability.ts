import { LOGISTICS_EXPENSE_COLLECTIONS } from './cashOutflows';
import { isExcludedFromOpex } from '../../utils/finance';
import { matchesProfitabilityBranch } from '../../utils/profitabilityScope';
import type { FinanceDateRange } from '../../utils/financeDateFilters';
import { amountValue, code, profitabilityDate, receiptProfitabilityEntries, textValue, type ProfitabilityRecord } from './profitabilitySales';

export { profitabilityDate } from './profitabilitySales';
export type { ProfitabilityRecord } from './profitabilitySales';

export const operatingExpenseLabels = {
  branch: 'Branch Operating Expenses',
  management: 'HQ and Management Expenses',
  payroll: 'Payroll and Staff Costs',
  logistics: 'Logistics Expenses',
  marketing: 'Marketing Expenses',
  consumables: 'Operational Consumables',
  inventoryLoss: 'Confirmed Inventory Losses',
} as const;

type OperatingCategory = keyof typeof operatingExpenseLabels;
type Category = OperatingCategory | 'financialCharges' | 'otherIncome' | 'nonoperatingExpenses';
type Source = 'branch_expenses' | 'management_expenses' | 'payroll' | 'marketing_expenses' |
  'operational_inventory_maintenance' | 'operational_finance_events' | 'inventoryMovementEvents' |
  'petty_cash_ledger' | 'banking_records' | 'finance_ledger' | typeof LOGISTICS_EXPENSE_COLLECTIONS[number];
export type ProfitabilityData = Partial<Record<Source | 'sales' | 'grn_records', ProfitabilityRecord[]>>;
export type ProfitabilityScope = { tenantId: string; branchId?: string; range?: FinanceDateRange };
type ExpenseEntry = {
  key: string;
  category: Category;
  amount: number | null;
  date: string;
  record: ProfitabilityRecord;
  description: string;
  reference: string;
};

const finalized = new Set(['approved', 'issued', 'paid', 'posted', 'completed', 'finalized', 'incurred', 'settled']);
const lossEvents = new Set(['EXPIRY', 'DAMAGE', 'WRITE_OFF']);
const chargeCodes = ['supplier_payment_charge', 'transfer_charge', 'bank_charge', 'bank_transaction_charge',
  'mobile_money_charge', 'mobile_money_transaction_charge', 'financial_service_charge', 'transaction_charge'];

export function isProfitabilityCharge(record: ProfitabilityRecord): boolean {
  return record.supplierCharge === true || chargeCodes.includes(code(record.movementClass));
}

export const profitabilityChargeCodes = chargeCodes;
export const profitabilityLossEvents = [...lossEvents];

function classifiedExpense(row: ProfitabilityRecord): Category | 'excluded' | null {
  const classification = code(row.accountingClassification).replace(/[ -]+/g, '_');
  const category = code(row.category ?? row.expenseCategory).replace(/[ -]+/g, '_');
  if (row.supplierPosting || row.supplierCharge === false || row.portfolioTransferId || row.transferId ||
      ['cash_grn', 'procurement_cash_grn', 'credit_payment', 'hr_salary', 'hr_advance'].includes(code(row.source)) ||
      isExcludedFromOpex({ source: code(row.source), sourceType: code(row.sourceType), excludeFromOpexRollup: row.excludeFromOpexRollup as boolean | undefined }) ||
      [classification, category].some(value => ['salary_advance', 'salaries_advance_request', 'salaries_payroll_disbursal',
        'payroll_settlement', 'supplier_settlement', 'liability_settlement', 'internal_transfer',
        'inventory_acquisition', 'sellable_inventory_acquisition', 'fixed_asset_acquisition', 'fixed_asset',
        'capital_expenditure', 'capex', 'procurement_cash_invoice', 'wastage', 'inventory_loss'].includes(value))) return 'excluded';
  if ([classification, category].some(value => chargeCodes.includes(value) || ['financial_charges', 'financial_service_expenses', 'bank_charges', 'mobile_money_charges', 'transfer_fee'].includes(value))) return 'financialCharges';
  if (classification === 'nonoperating_expense') return 'nonoperatingExpenses';
  if (['staff_welfare', 'staff_costs', 'payroll', 'staff_allowances', 'allowances'].includes(category)) return 'payroll';
  return null;
}

const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function payrollDate(row: ProfitabilityRecord): string {
  const end = profitabilityDate(row.periodEnd, row.period_end, row.accountingDate);
  if (end) return end;
  const label = code(row.month);
  const named = /^([a-z]+) (\d{4})$/.exec(label);
  const numeric = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(label);
  const month = numeric ? Number(numeric[2]) : named ? months.indexOf(named[1]) + 1 : months.indexOf(label) + 1;
  const year = Number(numeric?.[1] ?? named?.[2] ?? row.year);
  return month && year >= 1900 && year <= 9998 ? new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) : '';
}

function payrollCost(row: ProfitabilityRecord): number | null {
  const gross = amountValue(row.gross_salary);
  const base = amountValue(row.base_salary);
  const leave = amountValue(row.unpaid_leave_deduction) ?? 0;
  const earnings = gross ?? (base === null ? null : Math.max(0, base + (amountValue(row.allowances) ?? 0) - leave));
  return earnings === null ? null : earnings + (amountValue(row.nssf_employer) ?? 0);
}

function expenseEntries(data: ProfitabilityData, tenantId: string): ExpenseEntry[] {
  const entries = new Map<string, ExpenseEntry>();
  const bySource = new Map(Object.entries(data).map(([source, records]) =>
    [source, records.filter(row => row.tenantId === tenantId)]));
  const rows = (source: keyof ProfitabilityData) => bySource.get(source) ?? [];
  const grns = new Map(rows('grn_records').map(row => [row.id, row]));
  const add = (key: string, category: Category, row: ProfitabilityRecord, amount: number | null, date: string, description: string, reference = '') => {
    if (!entries.has(key)) entries.set(key, { key, category, record: row, amount, date, description, reference });
  };
  const expenseDate = (row: ProfitabilityRecord) => profitabilityDate(row.accountingDate, row.expense_date, row.date, row.created_at, row.createdAt);
  const receipt = (row: ProfitabilityRecord) => textValue(row.receipt_number ?? row.paymentReference ?? row.invoiceNumber);
  const scopes = [
    ...LOGISTICS_EXPENSE_COLLECTIONS.map(source => [source, 'logistics'] as const),
    ['marketing_expenses', 'marketing'],
    ['operational_inventory_maintenance', 'management'],
    ['branch_expenses', 'branch'],
    ['management_expenses', 'management'],
  ] as const;

  // The originating expense owns both the date and branch. Linked payment and mirror rows never create an additional expense.
  const mirrors: { source: Source; row: ProfitabilityRecord; category: OperatingCategory }[] = [];
  const addExpense = (key: string, category: OperatingCategory, row: ProfitabilityRecord) => {
    const classification = classifiedExpense(row);
    if (classification === 'excluded') return;
    const amount = amountValue(row.amount_ugx ?? row.cost_ugx ?? row.fine_amount_ugx ?? row.amount ?? row.cost);
    const finalCategory = classification ?? category;
    add(key, finalCategory, row, amount, expenseDate(row), textValue(row.category) || operatingExpenseLabels[category], receipt(row));
  };
  for (const [source, category] of scopes) {
    for (const row of rows(source)) {
      const status = code(row.status);
      // A traffic fine is logged as an incurred charge; its pending status tracks collection from the driver.
      const incurredFine = source === 'traffic_fine_logs' && status === 'pending';
      const needsApproval = source === 'branch_expenses' || source === 'management_expenses';
      if (!incurredFine && ((status && !finalized.has(status)) || (needsApproval && !status))) continue;
      const linkedCollection = textValue(row.externalExpenseCollection ?? row.sourceCollection);
      const linkedId = textValue(row.externalExpenseId ?? row.sourceId ?? row.sourceRefId);
      if (linkedId && linkedCollection !== source && scopes.some(([name]) => name === linkedCollection)) {
        mirrors.push({ source: linkedCollection as Source, row, category });
      } else {
        addExpense(source + '/' + row.id, category, row);
      }
    }
  }
  for (const { source, row, category } of mirrors) {
    const id = textValue(row.externalExpenseId ?? row.sourceId ?? row.sourceRefId);
    // A referenced draft or excluded source does not become recognizable through a payment mirror.
    if (!rows(source).some(origin => origin.id === id)) {
      addExpense(source + '/' + id, scopes.find(([name]) => name === source)?.[1] ?? category, row);
    }
  }

  const finalizedPayroll = new Map<string, { row: ProfitabilityRecord; amount: number | null }>();
  for (const row of rows('payroll')) {
    if (!finalized.has(code(row.status))) continue;
    const start = profitabilityDate(row.periodStart, row.period_start);
    const end = profitabilityDate(row.periodEnd, row.period_end);
    const staffId = textValue(row.staffId ?? row.staff_id);
    const key = start && end && staffId ? `payroll/${staffId}/${start}/${end}` : 'payroll/' + row.id;
    const amount = payrollCost(row);
    const prior = finalizedPayroll.get(key);
    if (!prior) finalizedPayroll.set(key, { row, amount });
    else if (prior.amount !== amount || (prior.row.branchId ?? prior.row.branch_id) !== (row.branchId ?? row.branch_id)) {
      // Conflicting finalized records for the same staff and exact pay period require reconciliation.
      prior.amount = null;
    }
  }
  for (const [key, { row, amount }] of finalizedPayroll) {
    add(key, 'payroll', row, amount, payrollDate(row), 'Finalized payroll');
  }

  for (const row of rows('operational_finance_events')) {
    if (row.eventKind !== 'OPERATIONAL_CONSUMABLE_OPEX' || row.status !== 'READY_FOR_FINANCE' ||
        row.sourceType !== 'OPERATIONAL_GRN' || !textValue(row.sourceId)) continue;
    const grn = grns.get(textValue(row.sourceId));
    const branchId = textValue(grn?.destination_branch_id) || (row.destinationStoreId === 'HQ_OPERATIONAL' ? 'HQ' : '');
    add('consumables/' + row.sourceId, 'consumables', { ...row, branchId }, amountValue(row.amountUGX),
      profitabilityDate(grn?.receivedAt, row.createdAt), 'Operational consumables received', textValue(grn?.grn_number ?? row.invoiceNumber));
  }

  for (const row of rows('inventoryMovementEvents')) {
    if (!lossEvents.has(textValue(row.eventType)) || !(Number(row.quantityDeltaBaseUnits) < 0) ||
        row.sourceCollection !== 'product_batches' || !textValue(row.sourceDocumentId) || !textValue(row.createdBy)) continue;
    const cost = amountValue(row.valuationUnitCostUGX);
    const label = row.eventType === 'EXPIRY' ? 'Stock expiry' : row.eventType === 'DAMAGE' ? 'Stock damage' : 'Stock write-off';
    add('inventory-loss/' + row.id, 'inventoryLoss', row, cost === null ? null : -Number(row.quantityDeltaBaseUnits) * cost,
      profitabilityDate(row.dateKey, row.effectiveAt), label, textValue(row.valuationReference));
  }

  for (const source of ['petty_cash_ledger', 'banking_records'] as const) {
    for (const row of rows(source)) {
      if (!isProfitabilityCharge(row) || !['outgoing', 'withdrawal'].includes(code(row.type))) continue;
      const supplier = row.supplierCharge === true || row.movementClass === 'supplier_payment_charge';
      const parentId = textValue(supplier ? row.paymentId : row.portfolioTransferId);
      if (supplier && (!parentId || ![parentId + '_fee', 'credit_payment_' + parentId + '_fee'].includes(row.id))) continue;
      if (row.movementClass === 'transfer_charge' && (!parentId || row.id !== parentId + '_fee')) continue;
      const grn = supplier ? grns.get(textValue(row.grnId)) : undefined;
      const branch = supplier ? { ...row, branch_id: undefined, branchId: textValue(grn?.destination_branch_id) } : row;
      const key = supplier ? 'supplier-fee/' + parentId : parentId ? 'transfer-fee/' + parentId : 'fee/' + row.id;
      const amount = amountValue(row.amount);
      if (row.accountDeltaUGX !== undefined && row.accountDeltaUGX !== -(amount ?? 0)) continue;
      add(key, 'financialCharges', branch, amount, profitabilityDate(row.accountingDate, row.date, row.createdAt),
        supplier ? 'Supplier payment charge' : row.movementClass === 'transfer_charge' ? 'Portfolio transfer charge' : 'Financial service charge',
        textValue(row.externalReference ?? row.reference_number));
    }
  }
  for (const row of rows('finance_ledger')) {
    if (row.status && !finalized.has(code(row.status))) continue;
    const type = code(row.entry_type);
    const classification = classifiedExpense(row);
    const category = classification === 'excluded' ? null
      : type === 'other_income' ? 'otherIncome'
      : classification === 'financialCharges' || chargeCodes.includes(type) ? 'financialCharges'
      : type === 'nonoperating_expense' || classification === 'nonoperatingExpenses' ? 'nonoperatingExpenses' : null;
    if (!category) continue;
    const paymentId = textValue(row.paymentId);
    const transferId = textValue(row.portfolioTransferId);
    const key = category === 'financialCharges' && paymentId ? 'supplier-fee/' + paymentId
      : category === 'financialCharges' && transferId ? 'transfer-fee/' + transferId
      : 'finance_ledger/' + row.id;
    add(key, category, row, amountValue(row.amount_ugx ?? row.amount), profitabilityDate(row.accountingDate, row.entry_date),
      category === 'otherIncome' ? 'Other recorded income' : category === 'financialCharges' ? 'Financial service charge' : 'Nonoperating expense',
      receipt(row));
  }
  return [...entries.values()];
}

export function calculateProfitability(data: ProfitabilityData, scope: ProfitabilityScope) {
  const inScope = (row: ProfitabilityRecord) => row.tenantId === scope.tenantId &&
    (scope.branchId === undefined || matchesProfitabilityBranch(row, scope.tenantId, scope.branchId));
  const inPeriod = (date: string) => !scope.range || !!date &&
    (!scope.range.start || date >= scope.range.start) && (!scope.range.end || date <= scope.range.end);
  const sales = new Map((data.sales ?? []).filter(inScope).map(row => [row.id, row]));
  const salesEntries = [...sales.values()].flatMap(receiptProfitabilityEntries);
  const statementSales = salesEntries.filter(entry => inPeriod(entry.date));
  const expenses = expenseEntries(data, scope.tenantId).filter(entry => inScope(entry.record));
  const statementExpenses = expenses.filter(entry => inPeriod(entry.date));
  const totals = { branch: 0, management: 0, payroll: 0, logistics: 0, marketing: 0, consumables: 0,
    inventoryLoss: 0, financialCharges: 0, otherIncome: 0, nonoperatingExpenses: 0 };
  for (const entry of statementExpenses) totals[entry.category] += entry.amount ?? 0;
  const missingSaleDates = salesEntries.filter(entry => !entry.date || entry.adjustmentDateMissing).length;
  const missingExpenseDates = expenses.filter(entry => !entry.date).length;
  const missingRevenue = statementSales.filter(entry => entry.net === null).length;
  const missingCogs = statementSales.filter(entry => entry.cost.amount === null).length;
  const missingAttribution = scope.branchId === undefined ? statementExpenses.filter(entry =>
    (entry.category === 'financialCharges' && entry.key.startsWith('supplier-fee/') || entry.category === 'consumables') &&
    !entry.record.branchId && !entry.record.branch_id).length : 0;
  const missingPayroll = statementExpenses.filter(entry => entry.category === 'payroll' && entry.amount === null).length;
  const missingInventory = statementExpenses.filter(entry => entry.category === 'inventoryLoss' && entry.amount === null).length;
  const missingOtherAmounts = statementExpenses.filter(entry => !['payroll', 'inventoryLoss'].includes(entry.category) && entry.amount === null).length;
  const grossSales = statementSales.some(entry => entry.gross === null) ? null : statementSales.reduce((sum, entry) => sum + entry.gross!, 0);
  const discounts = statementSales.some(entry => entry.discount === null) ? null : statementSales.reduce((sum, entry) => sum + entry.discount!, 0);
  const returns = statementSales.reduce((sum, entry) => sum + entry.returns, 0);
  const netSales = statementSales.reduce((sum, entry) => sum + (entry.net ?? 0), 0);
  const verifiedCogs = statementSales.reduce((sum, entry) => sum + (entry.cost.evidence === 'checkout' ? entry.cost.amount ?? 0 : 0), 0);
  const recoveredCogs = statementSales.reduce((sum, entry) => sum + (entry.cost.evidence === 'historical' ? entry.cost.amount ?? 0 : 0), 0);
  const knownCogs = verifiedCogs + recoveredCogs;
  const grossProfit = missingCogs || missingRevenue || missingSaleDates ? null : netSales - knownCogs;
  const operatingExpenses = (Object.keys(operatingExpenseLabels) as OperatingCategory[]).reduce((sum, category) => sum + totals[category], 0);
  const operatingProfit = grossProfit === null || missingExpenseDates || missingPayroll || missingInventory || missingOtherAmounts
    ? null : grossProfit - operatingExpenses;
  const netProfit = operatingProfit === null ? null : operatingProfit + totals.otherIncome - totals.financialCharges - totals.nonoperatingExpenses;
  const margin = (value: number | null) => value === null || netSales <= 0 ? null : 100 * value / netSales;
  const limitations = [
    missingCogs && `${missingCogs} sale or return records lack reliable COGS. Only supported costs are shown.`,
    missingRevenue && `${missingRevenue} sale or return records lack a reliable amount.`,
    missingSaleDates && `${missingSaleDates} sale or return records lack a reliable accounting date.`,
    missingExpenseDates && `${missingExpenseDates} expense records lack a reliable accounting date.`,
    missingPayroll && `${missingPayroll} finalized payroll records lack consistent gross earnings.`,
    missingAttribution && `${missingAttribution} procurement expenses or charges have no verified branch allocation.`,
    missingInventory && `${missingInventory} confirmed inventory losses lack recorded valuation.`,
    missingOtherAmounts && `${missingOtherAmounts} expense or income records lack a reliable amount.`,
  ].filter((message): message is string => !!message);

  return {
    grossSales, discounts, returns, netSales, verifiedCogs, recoveredCogs, knownCogs, grossProfit,
    grossMargin: margin(grossProfit), totals, operatingExpenses, operatingProfit, netProfit, netMargin: margin(netProfit),
    totalExpenses: operatingExpenses + totals.financialCharges + totals.nonoperatingExpenses, limitations,
    sales: statementSales, expenses: statementExpenses,
  };
}

export function profitabilityStatement(report: ReturnType<typeof calculateProfitability>) {
  const rows: { label: string; amount: number | null; percentage?: number | null; total?: boolean; sales?: boolean }[] = [
    { label: 'Gross Sales Revenue', sales: true, amount: report.grossSales },
    { label: 'Sales Discounts', sales: true, amount: report.discounts },
    { label: 'Returns and Refunds', sales: true, amount: report.returns },
    { label: 'Net Sales Revenue', sales: true, amount: report.netSales, total: true },
    { label: 'COGS with Recorded Evidence', sales: true, amount: report.knownCogs },
    { label: 'Gross Profit', sales: true, amount: report.grossProfit, percentage: report.grossMargin, total: true },
    ...Object.entries(operatingExpenseLabels).map(([category, label]) => ({ label, amount: report.totals[category as OperatingCategory] })),
    { label: 'Total Operating Expenses', amount: report.operatingExpenses },
    { label: 'Operating Profit', amount: report.operatingProfit, total: true },
    { label: 'Other Income', amount: report.totals.otherIncome },
    { label: 'Financial Charges', amount: report.totals.financialCharges },
    { label: 'Other Nonoperating Expenses', amount: report.totals.nonoperatingExpenses },
    { label: 'Total Recognized Expenses', amount: report.totalExpenses },
    { label: 'Net Profit Before Tax', amount: report.netProfit, percentage: report.netMargin, total: true },
  ];
  return rows;
}

export function profitabilityExportRows(report: ReturnType<typeof calculateProfitability>) {
  return [
    ...profitabilityStatement(report).map(row => ({
      'Metric': row.label, 'Value (UGX)': row.amount ?? 'Unavailable',
      'Margin': row.percentage == null ? '' : `${row.percentage.toFixed(1)}%`,
      'Notes': '',
    })),
    ...report.limitations.map(note => ({ 'Metric': 'Reporting limitation', 'Value (UGX)': '', 'Margin': '', 'Notes': note })),
  ];
}
