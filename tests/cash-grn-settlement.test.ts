import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planCashGrnSettlement } from '../src/services/cashGrnSettlementPolicy';

test('full payment settles supplier invoice and never generates second OPEX',()=>{
  const plan=planCashGrnSettlement(48000,0,48000);
  assert.deepEqual(plan,{
    originalInvoiceUGX:48000,previouslyPaidUGX:0,paymentUGX:48000,
    remainingUGX:0,paymentStatus:'Paid',legacyPaymentStatus:'Paid',
    cashMovementType:'outgoing',additionalOpexUGX:0
  });
});

test('partial payment leaves outstanding invoice balance and later installment settles',()=>{
  const first=planCashGrnSettlement(48000,0,10000);
  assert.equal(first.remainingUGX,38000);
  assert.equal(first.paymentStatus,'Partially Paid');
  const second=planCashGrnSettlement(48000,10000,38000);
  assert.equal(second.remainingUGX,0);
  assert.equal(second.additionalOpexUGX,0);
});

test('overpayment and invalid amounts are rejected',()=>{
  assert.throws(()=>planCashGrnSettlement(48000,0,48001),/outstanding/);
  assert.throws(()=>planCashGrnSettlement(48000,48000,1),/outstanding/);
  assert.throws(()=>planCashGrnSettlement(48000,0,0),/positive/);
  assert.throws(()=>planCashGrnSettlement(48000,0,1.5),/invalid/);
  assert.throws(()=>planCashGrnSettlement(48000,49000,1),/exceeds/);
});

test('settlement uses the shared account guard and a dedicated invoice payment interface',()=>{
  const service=readFileSync(new URL('../src/services/cashGrnSettlementService.ts',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../src/pages/finance/management/ManagementExpenseLedger.tsx',import.meta.url),'utf8');
  assert.match(service,/paymentId = `procurement_cash_settlement_/);
  assert.match(service,/tx\.get\(paymentRef\)/);
  assert.match(service,/if \(payment\.exists\(\)\)/);
  assert.match(service,/stageManagementCashEntry\(tx, paymentId,/);
  assert.match(service,/tx\.get\(accountRef\)/);
  assert.doesNotMatch(service,/getDocs\(|availableUGX|petty_cash_posting_locks/);
  assert.match(ui,/SupplierInvoicePaymentPanel/);
  assert.match(service,/tx\.update\(invoiceRef,/);
  assert.match(service,/tx\.update\(draftRef,/);
  assert.match(ui,/reviewingExpense\.source === 'procurement_cash_grn'/);
  assert.doesNotMatch(ui,/settleCashGrnDraft\(/);
});
