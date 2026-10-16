import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const service=readFileSync(new URL('../src/services/operationalGrnService.ts',import.meta.url),'utf8');
const procurement=readFileSync(new URL('../src/pages/Procurement.tsx',import.meta.url),'utf8');
const rules=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');

test('Operational GRN requires Cash or Credit and embeds payment terms in retry fingerprint',()=>{
  assert.match(service,/paymentType: SupplierPaymentTerms/);
  assert.match(service,/if \(!\['cash', 'credit'\]\.includes\(input\.paymentType\)\)/);
  assert.match(service,/paymentType: input\.paymentType,\s*items: receivedInput/);
});

test('Operational GRN posts single invoice and conditional cash draft/credit liability atomically',()=>{
  assert.match(service,/const financePlan = planCentralGrnFinance\(/);
  assert.match(service,/transaction\.set\(invoiceRef, invoiceData\)/);
  assert.match(service,/transaction\.set\(registerRef, invoiceData\)/);
  assert.match(service,/transaction\.set\(creditRef,/);
  assert.match(service,/transaction\.set\(cashDraftRef,/);
  assert.match(service,/status: 'draft', paymentStatus: 'pending_payment'/);
  assert.match(service,/excludeFromOpexRollup: true/);
  assert.match(service,/financial_posting_status: 'posted'/);
  assert.doesNotMatch(service,/transaction\.set\([^\n]*petty_cash_ledger/);
});

test('Operational remains separate from Sellable and both retain correct GRN fields',()=>{
  const part=procurement.slice(procurement.indexOf('const GRNProcessModal:'), procurement.indexOf('const GRNProcessModal:')+16000);
  assert.match(part,/tenantId, order, lines, editedLines, invoiceNumber, invoiceDate, paymentType, inputVat/);
  assert.match(part,/setPaymentType\('cash'\)/);
  assert.match(part,/setPaymentType\('credit'\)/);
  assert.match(part,/!isOperationalOrder && <th[^\n]*Batch/);
  assert.match(service,/inventoryClass: 'OPERATIONAL'/);
  assert.match(service,/planOperationalGrnFinanceEvents\(/);
});

test('Firestore draft reads cover either Operational or Sellable GRN IDs and restrict arbitrary writes',()=>{
  const fragment=rules.slice(rules.indexOf('match /management_expenses/{expenseId}'),rules.indexOf('match /campaigns/{campaignId}'));
  assert.match(fragment,/management_payment_draft_\(grn_\|op_grn_\)/);
  assert.match(fragment,/expenseId == 'management_payment_draft_' \+ request\.resource\.data\.grnId/);
  assert.match(fragment,/request\.resource\.data\.status == 'draft'/);
});
