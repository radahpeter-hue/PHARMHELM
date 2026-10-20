import test from 'node:test';
import assert from 'node:assert/strict';
import { planFinanceV2Transfer, type FinanceV2AccountSnapshot } from '../src/services/financeV2TransferPolicy';

const accounts: FinanceV2AccountSnapshot[] = [
  {tenantId:'tenant-a',accountId:'source',kind:'BANK',balanceUGX:1004000,active:true},
  {tenantId:'tenant-a',accountId:'destination',kind:'BRANCH_CASH_SALES',balanceUGX:5000,active:true},
  {tenantId:'tenant-a',accountId:'fees',kind:'PETTY_CASH',balanceUGX:20000,active:true},
  {tenantId:'tenant-b',accountId:'other',kind:'BANK',balanceUGX:9999999,active:true}
];
const request = {
  tenantId:'tenant-a',requestId:'transfer-1',sourceAccountId:'source',destinationAccountId:'destination',
  chargePayerAccountId:'source',principalUGX:1000000,chargeUGX:4000,actorUid:'finance-user'
};

test('full principal arrives; charge is additional to principal and expensed once',()=>{
  const p=planFinanceV2Transfer(request,accounts);
  assert.deepEqual(p.accountDeltas,[
    {accountId:'source',deltaUGX:-1004000},
    {accountId:'destination',deltaUGX:1000000}
  ]);
  assert.equal(p.externalChargeExpenseUGX,4000);
  assert.equal(p.idempotencyKey,'finance_v2_transfer_tenant-a_transfer-1');
});

test('zero charges allowed and separate payer funded independently',()=>{
  const noFee=planFinanceV2Transfer({...request,chargeUGX:0},accounts);
  assert.equal(noFee.movements.length,2);
  const other=planFinanceV2Transfer({...request,chargePayerAccountId:'fees'},accounts);
  assert.deepEqual(other.accountDeltas.map(x=>x.deltaUGX),[-1000000,1000000,-4000]);
});

test('insufficient aggregate funding rejects principal plus charge',()=>{
  assert.throws(()=>planFinanceV2Transfer(request,accounts.map(a=>a.accountId==='source'?{...a,balanceUGX:1000000}:a)),/Insufficient funds/);
  assert.throws(()=>planFinanceV2Transfer({...request,chargePayerAccountId:'fees',chargeUGX:21000},accounts),/Insufficient funds/);
});

test('rejects cross-tenant and inactive destination',()=>{
  assert.throws(()=>planFinanceV2Transfer({...request,destinationAccountId:'other'},accounts),/outside tenant/);
  assert.throws(()=>planFinanceV2Transfer(request,accounts.map(a=>a.accountId==='destination'?{...a,active:false}:a)),/inactive/);
});

test('rejects invalid money and contradictory account references',()=>{
  assert.throws(()=>planFinanceV2Transfer({...request,chargeUGX:-1},accounts),/Charge/);
  assert.throws(()=>planFinanceV2Transfer({...request,principalUGX:0},accounts),/Principal/);
  assert.throws(()=>planFinanceV2Transfer({...request,principalUGX:1.5},accounts),/Principal/);
  assert.throws(()=>planFinanceV2Transfer({...request,destinationAccountId:'source'},accounts),/must differ/);
  assert.throws(()=>planFinanceV2Transfer({...request,requestId:'bad/id'},accounts),/Invalid requestId/);
});
