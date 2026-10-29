import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('031 treasury cannot consume EOD declarations as cash funding', () => {
  const source=readFileSync('src/pages/finance/management/CashAndBanking.tsx','utf8');
  assert.doesNotMatch(source,/eod_reconciliations|cash_actual|card_actual|momo_actual|airtel_actual|staff_welfare_actual/);
  assert.match(source,/registeredBank.balanceUGX/);
  assert.match(source,/totalTransferredToBanked - totalTransferredFromBanked/);
});
test('031 EOD submission service has exactly one monetary-free write destination', () => {
  const source=readFileSync('src/services/eodSubmissionService.ts','utf8');
  assert.match(source,/doc\(connection, 'eod_reconciliations', id\)/);
  assert.doesNotMatch(source,/banking_transactions|finance_ledger|pos_payments|cashTransfers|petty_cash_ledger/);
});
