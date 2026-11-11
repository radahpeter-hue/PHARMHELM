import test from 'node:test';
import assert from 'node:assert/strict';
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
