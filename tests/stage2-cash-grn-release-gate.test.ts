import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Stage 2 release gate: until all global petty-cash postings are transactionally
 * coordinated, the prototype cash-GRN settlement must remain inaccessible.
 * Explicitly document the writers needing migration rather than weakening the
 * existing pending-payment guard.
 */
test('Cash GRN settlement stays disabled while legacy petty-cash writers are uncoordinated', () => {
  const finance = readFileSync(new URL('../src/pages/finance/management/ManagementExpenseLedger.tsx', import.meta.url), 'utf8');
  const prototype = readFileSync(new URL('../src/services/cashGrnSettlementService.ts', import.meta.url), 'utf8');
  const cashBank = readFileSync(new URL('../src/pages/finance/management/CashAndBanking.tsx', import.meta.url), 'utf8');
  const logistics = readFileSync(new URL('../src/modules/logistics/CostLedger.tsx', import.meta.url), 'utf8');
  const welfare = readFileSync(new URL('../src/pages/Welfare.tsx', import.meta.url), 'utf8');
  assert.match(prototype, /Do not enable in live Finance until ALL legacy petty-cash writers/);
  assert.match(finance, /reviewingExpense\.source === 'procurement_cash_grn'/);
  assert.match(finance, /disabled=\{reviewingExpense\.source === 'procurement_cash_grn'\}/);
  assert.doesNotMatch(finance, /settleCashGrnDraft\(/);
  // These source paths need coordinated migration before any cash draft is payable.
  for (const source of [cashBank, logistics, welfare]) {
    assert.match(source, /petty_cash_ledger/);
  }
});
