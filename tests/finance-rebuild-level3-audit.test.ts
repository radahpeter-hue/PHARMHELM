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

import { eodReportRecord } from '../src/utils/eodReport';
test('EOD reports use business date/shift, preserve declared zero and normalize float variance', () => {
  const record={reconciliation_date:'2026-10-27',created_at:'2026-10-28T23:00:00Z',shift_id:'dayShift',shift_name:'Day Shift',total_expected:500000,total_actual:0,momo_expected:500000,momo_actual:0};
  const result=eodReportRecord(record);assert.equal(result.businessDate,'2026-10-27');assert.equal(result.shift,'Day Shift');assert.equal(result.declared,0);assert.equal(result.variance,-500000);
  assert.equal(eodReportRecord({date:'2020-01-01',cash_expected:0.1+0.2,cash_actual:0.3}).variance,0);
  assert.equal(eodReportRecord({date:'2020-01-01'}).shift,'Historical whole-day — shift not recorded');
});
