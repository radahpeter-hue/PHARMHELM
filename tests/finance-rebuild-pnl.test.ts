import test from 'node:test';
import assert from 'node:assert/strict';
import { profitabilityPeriodRange } from '../src/utils/profitabilityPeriod';

test('P&L calendar presets map to explicit inclusive dates without changing accounting', () => {
  const anchor = '2026-10-28';
  assert.deepEqual(profitabilityPeriodRange('today', anchor), { start: anchor, end: anchor });
  assert.deepEqual(profitabilityPeriodRange('week', anchor), { start: '2026-10-26', end: '2026-11-01' });
  assert.deepEqual(profitabilityPeriodRange('month', anchor), { start: '2026-10-01', end: anchor });
  assert.deepEqual(profitabilityPeriodRange('quarterly', anchor), { start: '2026-10-01', end: '2026-12-31' });
  assert.deepEqual(profitabilityPeriodRange('monthly', anchor), { start: '2026-10-01', end: '2026-10-31' });
  assert.deepEqual(profitabilityPeriodRange('biannual', anchor), { start: '2026-07-01', end: '2026-12-31' });
  assert.deepEqual(profitabilityPeriodRange('annual', anchor), { start: '2026-01-01', end: '2026-12-31' });
});

test('P&L periods handle leap years, half-year and week/year boundaries', () => {
  assert.deepEqual(profitabilityPeriodRange('monthly', '2024-02-12'), { start: '2024-02-01', end: '2024-02-29' });
  assert.deepEqual(profitabilityPeriodRange('biannual', '2026-06-30'), { start: '2026-01-01', end: '2026-06-30' });
  assert.deepEqual(profitabilityPeriodRange('week', '2026-01-01'), { start: '2025-12-29', end: '2026-01-04' });
});

import { matchesProfitabilityBranch } from '../src/utils/profitabilityScope';
test('branch P&L matches tenant and branch across existing field aliases without HQ allocation', () => {
  assert.equal(matchesProfitabilityBranch({ tenantId: 't', branchId: 'masaka' }, 't', 'masaka'), true);
  assert.equal(matchesProfitabilityBranch({ tenantId: 't', branch_id: 'masaka' }, 't', 'masaka'), true);
  for (const record of [{ tenantId: 'other', branchId: 'masaka' }, { tenantId: 't', branchId: 'other' }, { tenantId: 't' }]) {
    assert.equal(matchesProfitabilityBranch(record, 't', 'masaka'), false);
  }
  assert.equal(matchesProfitabilityBranch({ tenantId: 't', branchId: 'masaka' }, 't', ''), false);
});

import fs from 'node:fs';
test('Branch and Consolidated P&L remain distinct within existing management access', () => {
  const finance = fs.readFileSync('src/pages/Finance.tsx', 'utf8');
  assert.match(finance, /id: 'branch_profitability', label: 'Branch P&L'/);
  assert.match(finance, /id: 'profitability', label: 'Consolidated Organisation P&L'/);
  assert.match(finance, /canUseManagementFinance/);
  const pnl = fs.readFileSync('src/pages/finance/management/ProfitabilityLedger.tsx', 'utf8');
  const analytics = fs.readFileSync('src/components/analytics/FinanceAnalytics.tsx', 'utf8');
  const source = fs.readFileSync('src/hooks/useProfitabilityData.ts', 'utf8');
  assert.match(source, /where\('tenantId', '==', tenantId\)/);
  for (const view of [pnl, analytics]) {
    assert.match(view, /calculateProfitability\(result.data/);
    assert.match(view, /profitabilityStatement\(report\)/);
  }
  assert.match(pnl, /profitabilityExportRows\(report\)/);
});

import { calculateProfitability, profitabilityExportRows, profitabilityStatement, type ProfitabilityData, type ProfitabilityRecord } from '../src/domain/finance/profitability';
import { receiptProfitabilityEntries, saleCostEvidence } from '../src/domain/finance/profitabilitySales';
import { analyticsProfitabilityRange } from '../src/utils/profitabilityPeriod';

const tenantId = 'martin-pharma';
const branchId = 'masaka';
const range = { start: '2026-11-01', end: '2026-11-30' };
const row = (id: string, fields: Record<string, unknown> = {}): ProfitabilityRecord => ({
  id, tenantId, branchId, date: '2026-11-11', ...fields,
});
const receipt = (id: string, fields: Record<string, unknown> = {}) => row(id, {
  status: 'completed', receiptNumber: `MP-${id}`, timestamp: '2026-11-11T08:00:00Z',
  total: 100_000, subtotal: 100_000, actualSaleCost: 60_000, ...fields,
});
const statement = (data: ProfitabilityData, branch?: string) => calculateProfitability(data, { tenantId, branchId: branch, range });

test('POS receipt totals recognize cash, mobile money, card, credit and split sales exactly once', () => {
  const sales = ['cash', 'mtn_momo', 'airtel_money', 'card', 'institutional_credit', 'staff_welfare'].map((method, i) =>
    receipt(String(i), {
      subtotal: 110_000, discountAmount: 10_000, totalAmount: 100_000, paymentMethod: method,
      ...(method === 'staff_welfare' ? { secondaryPaymentMethod: 'cash', secondaryAmount: 50_000 } : {}),
    }));
  const data: ProfitabilityData = {
    sales: [...sales, sales[0], receipt('void', { status: 'voided' }), receipt('pending', { status: 'pending' }),
      receipt('other-tenant', { tenantId: 'different-tenant' })],
    banking_records: [row('mobile-transfer', { movementClass: 'transfer_in', type: 'incoming', amount: 100_000 }),
      row('receivable-collection', { type: 'incoming', amount: 100_000 })],
  };
  const pnl = statement(data, branchId);
  assert.equal(pnl.grossSales, 660_000);
  assert.equal(pnl.discounts, 60_000);
  assert.equal(pnl.netSales, 600_000);
  assert.equal(pnl.knownCogs, 360_000);
  assert.equal(pnl.grossProfit, 240_000);
  assert.equal(pnl.grossMargin, 40);
});

test('a completed revision counts only the replacement at the original POS accounting date', () => {
  const original = receipt('original', { revisionLifecycle: 'COMPLETED', supersededBySaleId: 'corrected' });
  const replacement = receipt('corrected', {
    isRevisionReplacement: true, revisionOfSaleId: 'original', revisionRecordedAt: '2026-12-11T13:00:00Z',
    totalAmount: 80_000, subtotal: 100_000, discountAmount: 20_000, actualSaleCost: 50_000,
  });
  const report = statement({ sales: [original, replacement, receipt('requested', { revisionLifecycle: 'REQUESTED' })] });
  assert.equal(report.netSales, 180_000);
  assert.equal(report.knownCogs, 110_000);
  assert.equal(report.sales.length, 2);
});

test('partial and full refunds reverse revenue on the adjustment date and reverse COGS only with stock evidence', () => {
  const sales = [
    receipt('partial', { status: 'partially_refunded', refundAmount: 20_000, refundedAt: '2026-12-02T12:00:00Z' }),
    receipt('restocked', { status: 'returned', returnedAt: '2026-12-02T12:00:00Z', inventoryRestored: true }),
    receipt('partial-restock', { status: 'partially_returned', returnAmount: 30_000, returnedCost: 18_000, returnedAt: '2026-12-02' }),
  ];
  assert.equal(statement({ sales }).netSales, 300_000);
  const later = calculateProfitability({ sales }, { tenantId, range: { start: '2026-12-01', end: '2026-12-31' } });
  assert.equal(later.returns, 150_000);
  assert.equal(later.netSales, -150_000);
  assert.equal(later.knownCogs, -78_000);
  assert.equal(later.grossProfit, -72_000);
  const undated = statement({ sales: [receipt('undated', { status: 'returned' })] });
  assert.equal(undated.grossProfit, null);
  assert.match(undated.limitations.join(' '), /accounting date/);
});

test('POS V2 batch acquisition snapshots determine multi-batch COGS and commercial quantity is applied once', () => {
  const items = [
    { commercialQuantity: 2, baseQuantity: 20, tierMultiplier: 10, costPrice: 800,
      batchAllocations: [{ batchId: 'first-fefo', baseQuantity: 12, costPerBaseUnit: 100 },
        { batchId: 'second-fefo', baseQuantity: 8, costPerBaseUnit: 50 }] },
    { isService: true, quantity: 1 },
  ];
  assert.deepEqual(saleCostEvidence({ actualSaleCost: 1600, items }), { amount: 1600, evidence: 'checkout' });
  assert.deepEqual(saleCostEvidence({ items }), { amount: 1600, evidence: 'historical' });
  assert.deepEqual(saleCostEvidence({ items: [{ quantity: 2, tierMultiplier: 10, costPrice: 800, batchNumber: 'old-batch' }] }),
    { amount: 1600, evidence: 'historical' });
  assert.deepEqual(saleCostEvidence({ total_cost: 800 }), { amount: 800, evidence: 'historical' });
  assert.equal(saleCostEvidence({ actualSaleCost: 800, items }).amount, null);
  assert.equal(saleCostEvidence({ actualSaleCost: 1600, items: [{ ...items[0], batchAllocations: [
    { batchId: 'missing-price', baseQuantity: 20, costPerBaseUnit: 0 },
  ] }] }).amount, null);
});

test('unknown COGS suppresses profit and a missing discount breakdown never changes recorded net revenue', () => {
  const pnl = statement({ sales: [receipt('good'), receipt('legacy', {
    subtotal: undefined, actualSaleCost: undefined, total: 90_000,
  })] });
  assert.equal(pnl.grossSales, null);
  assert.equal(pnl.discounts, null);
  assert.equal(pnl.netSales, 190_000);
  assert.equal(pnl.knownCogs, 60_000);
  assert.equal(pnl.grossProfit, null);
  assert.equal(pnl.netProfit, null);
  assert.match(pnl.limitations.join(' '), /lack reliable COGS/);
  assert.equal(profitabilityExportRows(pnl).find(r => r.Metric === 'Net Profit Before Tax')?.['Value (UGX)'], 'Unavailable');
});

test('UGX 490,000 benchmark survives supplier settlement, mirrored expenses and a transfer of principal', () => {
  const fee = row('pay_fee', {
    branchId: 'other-branch', fundingBranchId: 'other-branch', supplierPosting: 'cash', supplierCharge: true,
    paymentId: 'pay', grnId: 'grn', amount: 10_000, accountDeltaUGX: -10_000, type: 'outgoing', externalReference: 'BANK-001',
  });
  const data: ProfitabilityData = {
    sales: [receipt('benchmark', { subtotal: 2_200_000, discountAmount: 200_000, totalAmount: 2_000_000, actualSaleCost: 1_200_000 })],
    branch_expenses: [row('rent', { expense_date: '2026-11-07', cashPaidAt: '2026-12-04', amount_ugx: 200_000, status: 'paid' }),
      row('draft', { amount_ugx: 99_000, status: 'pending' })],
    fuel_logs: [row('fuel', { cost_ugx: 60_000 })],
    marketing_expenses: [row('promo', { amount: 40_000, status: 'approved' })],
    management_expenses: [
      row('duplicate', { amount: 60_000, status: 'approved', externalExpenseCollection: 'fuel_logs', externalExpenseId: 'fuel', branchId: 'HQ' }),
      row('cash-payment', { amount: 900_000, status: 'paid', source: 'procurement_cash_grn', excludeFromOpexRollup: true }),
      row('fixed-asset', { amount: 999_000, status: 'approved', accountingClassification: 'fixed_asset_acquisition' }),
    ],
    grn_records: [row('grn', { destination_branch_id: branchId })],
    petty_cash_ledger: [fee, row('fuel-payment', { amount: 60_000, type: 'outgoing', externalExpenseId: 'fuel' })],
    banking_records: [fee, row('pay', { amount: 900_000, supplierCharge: false, type: 'outgoing' }),
      row('transfer', { amount: 300_000, movementClass: 'transfer_out', type: 'outgoing' })],
  };
  const pnl = statement(data, branchId);
  assert.equal(pnl.netSales, 2_000_000);
  assert.equal(pnl.grossProfit, 800_000);
  assert.equal(pnl.operatingExpenses, 300_000);
  assert.equal(pnl.operatingProfit, 500_000);
  assert.equal(pnl.totals.financialCharges, 10_000);
  assert.equal(pnl.netProfit, 490_000);
  assert.equal(statement(data).netProfit, 490_000);
  assert.equal(statement(data, 'other-branch').totals.financialCharges, 0);
  assert.equal(pnl.expenses.find(expense => expense.category === 'financialCharges')?.reference, 'BANK-001');
  const exported = profitabilityExportRows(pnl);
  assert.deepEqual(exported.map(r => r.Metric), profitabilityStatement(pnl).map(r => r.label));
  assert.equal(exported.find(r => r.Metric === 'Net Profit Before Tax')?.['Value (UGX)'], 490_000);
  assert.ok(!JSON.stringify(exported).includes('pay_fee'));
});

test('finalized gross payroll and employer contributions accrue once in the earned period', () => {
  const data: ProfitabilityData = {
    payroll: [row('gross', { month: 'November 2026', paid_date: '2026-12-03', status: 'paid',
      base_salary: 500_000, allowances: 50_000, unpaid_leave_deduction: 30_000, nssf_employer: 50_000,
      nssf_employee: 25_000, paye: 35_000, advance_deduction: 15_000, net_salary: 440_000 }),
    row('draft', { periodEnd: '2026-11-14', status: 'draft', gross_salary: 600_000 }),
    row('period', { month: 'December 2026', periodEnd: '2026-11-14', status: 'finalized', gross_salary: 100_000 })],
    management_expenses: [
      row('disbursal', { status: 'issued', source: 'hr_salary', amount: 440_000 }),
      row('advance', { status: 'paid', source: 'hr_advance', amount: 15_000 }),
      row('staff-benefit', { status: 'approved', category: 'Staff Welfare', amount: 25_000 }),
    ],
  };
  assert.equal(statement(data).totals.payroll, 695_000);
  const incomplete = statement({ payroll: [row('net-only', { month: 'November 2026', status: 'paid', net_salary: 500_000 })] });
  assert.equal(incomplete.netProfit, null);
  assert.match(incomplete.limitations.join(' '), /lack consistent gross earnings/);
});

test('confirmed valued loss and operational consumables are recognized once, with HQ retained in consolidated P&L', () => {
  const loss = row('loss', { eventType: 'EXPIRY', quantityDeltaBaseUnits: -10, sourceCollection: 'product_batches',
    sourceDocumentId: 'batch', createdBy: 'staff', dateKey: '2026-11-10', valuationUnitCostUGX: 500, valuationReference: 'ADJ-0001' });
  const data: ProfitabilityData = {
    inventoryMovementEvents: [loss, loss, row('return', { ...loss, id: 'return', eventType: 'RETURN_TO_STOCK' })],
    branch_expenses: [row('old-recall', { category: 'wastage', status: 'approved', amount: 9000 })],
    operational_finance_events: [
      row('event', { status: 'READY_FOR_FINANCE', sourceType: 'OPERATIONAL_GRN', sourceId: 'hq-grn',
        eventKind: 'OPERATIONAL_CONSUMABLE_OPEX', destinationStoreId: 'HQ_OPERATIONAL', amountUGX: 30_000, createdAt: '2026-11-15' }),
      row('asset', { status: 'READY_FOR_FINANCE', sourceType: 'OPERATIONAL_GRN', sourceId: 'hq-grn',
        eventKind: 'FIXED_ASSET_ACQUISITION', amountUGX: 4_000_000 }),
    ],
    grn_records: [row('hq-grn', { destination_branch_id: 'HQ', receivedAt: '2026-11-15' })],
    management_expenses: [row('hq-rent', { branchId: 'HQ', status: 'approved', amount: 100_000 })],
  };
  assert.equal(statement(data, branchId).totalExpenses, 5000);
  assert.equal(statement(data).totalExpenses, 135_000);
  const unvalued = statement({ inventoryMovementEvents: [{ ...loss, valuationUnitCostUGX: undefined }] });
  assert.equal(unvalued.totals.inventoryLoss, 0);
  assert.equal(unvalued.operatingProfit, null);
  assert.match(unvalued.limitations.join(' '), /lack recorded valuation/);
});

test('recorded transfer and bank fees affect pretax profit, while explicit other income has its own line', () => {
  const pnl = statement({
    petty_cash_ledger: [row('move_fee', { portfolioTransferId: 'move', movementClass: 'transfer_charge', amount: 5000, accountDeltaUGX: -5000, type: 'outgoing' })],
    banking_records: [row('bank-fee', { movementClass: 'bank_charge', type: 'withdrawal', amount: 1000 })],
    finance_ledger: [row('income', { entry_type: 'other_income', amount_ugx: 50_000, entry_date: '2026-11-12' }),
      row('interest', { entry_type: 'nonoperating_expense', amount_ugx: 20_000, entry_date: '2026-11-12' })],
  });
  assert.equal(pnl.operatingProfit, 0);
  assert.equal(pnl.totals.financialCharges, 6000);
  assert.equal(pnl.netProfit, 24_000);
  assert.equal(pnl.netMargin, null);
});

test('ISO and Firestore instant boundaries use Kampala while business dates stay fixed', () => {
  const sales = [receipt('before', { timestamp: '2026-10-31T20:59:59Z' }),
    receipt('first', { timestamp: '2026-10-31T21:00:00Z' }),
    receipt('last', { timestamp: { seconds: Date.parse('2026-11-30T20:59:59Z') / 1000 } }),
    receipt('after', { timestamp: '2026-11-30T21:00:00Z' })];
  assert.equal(statement({ sales }).netSales, 200_000);
  assert.equal(receiptProfitabilityEntries(receipt('business', { businessDate: '2026-10-31' }))[0].date, '2026-10-31');
  assert.deepEqual(analyticsProfitabilityRange('Last Month', '2026-11-12'), { start: '2026-10-01', end: '2026-10-31' });
  assert.deepEqual(analyticsProfitabilityRange('This Quarter', '2026-11-12'), { start: '2026-10-01', end: '2026-12-31' });
});

test('confirmed stock loss records valuation without reducing usable stock twice', async () => {
  const { logMovementAndAggregateInTx } = await import('../src/services/consumptionService');
  const { stockAdjustmentEventType } = await import('../src/services/stockAdjustmentService');
  assert.equal(stockAdjustmentEventType(-10, 'Quarantined damaged stock pending supplier return'), 'NEGATIVE_ADJUSTMENT');
  assert.equal(stockAdjustmentEventType(-10, 'Disposed expired stock'), 'EXPIRY');
  const writes = new Map<string, any>();
  const transaction = {
    async get(ref: { path: string }) {
      assert.equal(writes.size, 0, 'all transaction reads must precede writes');
      const data = ref.path === 'product_batches/expired' ? { quantity: 10, expiryDate: '2001-10-31', batch_status: 'active' }
        : ref.path === 'product_batches/sellable' ? { quantity: 25, expiryDate: '2099-01-01', batch_status: 'active' }
        : undefined;
      return { exists: () => !!data, data: () => data };
    },
    set(ref: { path: string }, data: unknown) { writes.set(ref.path, data); },
  };
  await logMovementAndAggregateInTx(transaction, [
    { ref: { path: 'product_batches/expired' }, id: 'expired' },
    { ref: { path: 'product_batches/sellable' }, id: 'sellable' },
  ], {
    tenantId, branchId, productId: 'product', eventType: 'EXPIRY', quantityDeltaBaseUnits: -10,
    usableQuantityDeltaBaseUnits: 0, consumptionDeltaBaseUnits: 0, isExceptional: false, exceptionalReason: null,
    sourceCollection: 'product_batches', sourceDocumentId: 'expired', sourceLineId: 'adjustment',
    reversalOfEventId: null, createdBy: 'operator', effectiveAt: new Date('2026-11-11T08:00:00Z'),
    valuationUnitCostUGX: 500, valuationReference: 'ADJ-001',
  });
  const summary = writes.get(`branchConsumptionDaily/${tenantId}_${branchId}_product_2026-11-11`);
  assert.equal(summary.closingUsableStock, 25);
  assert.equal(summary.unitsWrittenOff, 10);
  const loss = writes.get('inventoryMovementEvents/product_batches_expired_product_adjustment');
  assert.equal(statement({ inventoryMovementEvents: [{ id: 'loss', ...loss }] }).totals.inventoryLoss, 5000);
});
