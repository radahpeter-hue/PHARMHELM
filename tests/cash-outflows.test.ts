import test from 'node:test';
import assert from 'node:assert/strict';
import { collectCashOutflows, type CashMovementEvidence } from '../src/domain/finance/cashOutflows';

const tenantId = 'martin';
const accounts = [
  { id: 'martin_management_petty_cash', tenantId, accountId: 'management_petty_cash', name: 'HQ cash', kind: 'petty_cash', initialized: true, currency: 'UGX' },
  { id: 'martin_management_bank', tenantId, accountId: 'management_bank', name: 'HQ bank', kind: 'bank', initialized: true, currency: 'UGX' },
  { id: 'martin_system_petty_cash_masaka', tenantId, accountId: 'system_petty_cash_masaka', name: 'Masaka petty cash', kind: 'petty_cash', initialized: true, currency: 'UGX', scope: { kind: 'branch', branchId: 'masaka' } },
];

function debit(id: string, data: Partial<CashMovementEvidence> = {}): CashMovementEvidence {
  return { id, tenantId, collection: 'petty_cash_ledger', type: 'outgoing', amount: 100, accountDeltaUGX: -100,
    accountDocumentId: 'martin_management_petty_cash', postedBy: 'finance', date: '2026-11-09', ...data };
}

function report(movements: CashMovementEvidence[]) {
  return collectCashOutflows({ tenantId, accounts, movements, supplierPayments: [], creditPayments: [] });
}

test('supplier installments count once on actual Kampala payment days, without the invoice total or pending amount', () => {
  const supplierPayments = ['first', 'second', 'missing-debit'].map((id, index) => ({
    id, tenantId, amountUGX: 100, processedBy: 'finance', paymentAccountId: 'management_bank',
    invoiceId: 'invoice', grnId: 'grn', processedAt: '2026-11-' + String(8 + index).padStart(2, '0') + 'T23:00:00Z',
  }));
  const movements = supplierPayments.slice(0, 2).map(({ id }) => debit(id, {
    collection: 'banking_records', accountDocumentId: 'martin_management_bank', paymentId: id, invoiceId: 'invoice', grnId: 'grn',
  }));
  const rows = collectCashOutflows({ tenantId, accounts, movements: [...movements, movements[0]], supplierPayments, creditPayments: [] });
  assert.deepEqual(rows.map(({ amount, date, status }) => [amount, date, status]), [[100, '2026-11-10', 'posted'], [100, '2026-11-09', 'posted']]);
});

test('internal principal, branch floats and EOD corrections are excluded and external transfer fees are counted once', () => {
  const fee = debit('transfer_fee', { portfolioTransferId: 'transfer', movementClass: 'transfer_charge' });
  const rows = report([
    debit('principal', { portfolioTransferId: 'transfer', movementClass: 'transfer_out' }),
    debit('bank-petty', { transferId: 'legacy' }),
    debit('float', { source: 'Petty Cash Reserve' }),
    debit('correction', { eodCorrectionId: 'correction' }),
    fee, fee,
  ]);
  assert.deepEqual(rows.map(row => [row.sourceId, row.category, row.status]), [['transfer', 'Transfer fee', 'posted']]);
});

test('branch and management payments retain account and source; raw logs and unresolved historical debits cannot inflate the total', () => {
  const branch = debit('expense_payment_branch', {
    branchId: 'masaka', accountDocumentId: 'martin_system_petty_cash_masaka', externalExpenseId: 'branch',
    externalExpenseCollection: 'branch_expenses', expenseCategory: 'allowances',
  });
  const hq = debit('expense_payment_hq', { externalExpenseId: 'hq', externalExpenseCollection: 'management_expenses' });
  const rows = report([branch, hq, debit('old', { accountDocumentId: '', source: 'Legacy', date: '' }),
    debit('payroll-finalized', { type: 'paid' }), debit('pending-expense', { type: 'Pending' }),
    debit('foreign', { tenantId: 'different' }), debit('forged', { ...branch, id: 'forged', branchId: 'kampala' })]);
  assert.deepEqual(rows.filter(row => row.status === 'posted').map(row => [row.sourceId, row.branchId, row.accountId, row.category]), [
    ['branch', 'masaka', 'system_petty_cash_masaka', 'allowances'],
    ['hq', '', 'management_petty_cash', 'Management expense'],
  ]);
  assert.deepEqual(rows.filter(row => row.status === 'unverified').map(row => row.sourceId), ['forged', 'old']);
});
