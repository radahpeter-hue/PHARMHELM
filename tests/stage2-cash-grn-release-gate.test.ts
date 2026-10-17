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
  assert.match(prototype, /competing petty-cash writer migrated to the same transactional account balance/);
  assert.match(finance, /reviewingExpense\.source === 'procurement_cash_grn'/);
  assert.match(finance, /disabled=\{reviewingExpense\.source === 'procurement_cash_grn'\}/);
  assert.doesNotMatch(finance, /settleCashGrnDraft\(/);
  // These source paths need coordinated migration before any cash draft is payable.
  for (const source of [cashBank, logistics, welfare]) {
    assert.match(source, /petty_cash_ledger/);
  }
});


test('unlaunched supplier cash payment collections are protected from fallback tenant writes', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const start = rules.indexOf('function isProtectedFinanceCollection(collectionName)');
  const end = rules.indexOf('function canViewProcurement()', start);
  assert.ok(start >= 0 && end > start);
  const protectedCollections = rules.slice(start, end);
  assert.match(protectedCollections, /'cash_grn_payments'/);
  assert.match(protectedCollections, /'petty_cash_posting_locks'/);
  assert.match(protectedCollections, /'finance_payment_accounts'/);
});


test('supplier settlement debits a registered cash or bank account inside the invoice transaction', () => {
  const service = readFileSync(new URL('../src/services/cashGrnSettlementService.ts', import.meta.url), 'utf8');
  assert.match(service, /tx\.get\(accountRef\)/);
  assert.match(service, /account\.data\(\)\.initialized !== true/);
  assert.match(service, /account\.data\(\)\.kind === 'bank' \? bankLedgerRef : cashLedgerRef/);
  assert.match(service, /tx\.update\(accountRef,/);
  assert.match(service, /balanceUGX:accountBalance-amountUGX/);
  assert.doesNotMatch(service, /getDocs\(query\(collection\(connection,'petty_cash_ledger'/);
});
