import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const service = readFileSync(new URL('../src/services/procurementFinanceService.ts',import.meta.url),'utf8');
const rules = readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');

test('sellable cash GRN writes draft, never debits petty cash or checks petty cash funds',()=>{
  assert.match(service,/cashDraft: doc\(db, 'management_expenses', ids.cashDraftId\)/);
  assert.match(service,/transaction\.set\(refs\.cashDraft, \{/);
  assert.match(service,/source: 'procurement_cash_grn'/);
  assert.match(service,/status: 'draft', paymentStatus: 'pending_payment'/);
  assert.match(service,/excludeFromOpexRollup: true/);
  assert.doesNotMatch(service,/transaction\.set\(refs\.pettyCash,/);
  assert.doesNotMatch(service,/acquirePettyCashLease\(/);
  assert.doesNotMatch(service,/Insufficient Management Petty Cash/);
});

test('supplier invoice remains unpaid until Finance posts payment',()=>{
  assert.match(service,/paymentStatus: paymentType === 'cash' \? 'Pending Payment'/);
  assert.match(service,/paid_amount_ugx: 0/);
  assert.match(service,/payment_status: paymentType === 'cash' \? 'pending_payment'/);
  assert.match(service,/status: 'Unpaid'/);
  assert.match(service,/planCentralGrnFinance\(/);
});

test('GRN-generated draft rule requires matching completed GRN and invoice and no immediate pay',()=>{
  const start=rules.indexOf('match /management_expenses/{expenseId}');
  const block=rules.slice(start,rules.indexOf('\n    match /',start+10));
  assert.match(block,/request\.resource\.data\.status == 'draft'/);
  assert.match(block,/request\.resource\.data\.paymentStatus == 'pending_payment'/);
  assert.match(block,/request\.resource\.data\.excludeFromOpexRollup == true/);
  assert.match(block,/getAfter\(\/databases\/\$\(database\)\/documents\/grn_records\/\$\(request\.resource\.data\.grnId\)\)/);
  assert.match(block,/getAfter\(\/databases\/\$\(database\)\/documents\/invoices\/\$\(request\.resource\.data\.invoiceId\)\)/);
  assert.match(block,/request\.resource\.data\.createdBy == request\.auth\.uid/);
});
