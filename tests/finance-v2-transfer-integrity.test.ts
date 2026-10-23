import test from 'node:test';
import assert from 'node:assert/strict';
import {planFinanceV2Transfer} from '../src/services/financeV2TransferPolicy';
import {verifyFinanceV2TransferAudit} from '../src/services/financeV2TransferIntegrity';

const request={tenantId:'tenant',requestId:'req',sourceAccountId:'source',destinationAccountId:'dest',chargePayerAccountId:'source',principalUGX:50000,chargeUGX:1000,actorUid:'actor'};
const accounts=[
 {tenantId:'tenant',accountId:'source',kind:'BANK' as const,balanceUGX:80000,active:true},
 {tenantId:'tenant',accountId:'dest',kind:'BRANCH_CASH_SALES' as const,balanceUGX:2000,active:true}
];
const proof=()=>{
 const p=planFinanceV2Transfer(request,accounts);
 return {accountDeltas:p.accountDeltas.map(d=>{
  const before=accounts.find(a=>a.accountId===d.accountId)!.balanceUGX;
  return {...d,beforeUGX:before,afterUGX:before+d.deltaUGX};
 }),movements:p.movements.map(m=>({...m})),externalChargeExpenseUGX:p.externalChargeExpenseUGX};
};
test('canonical proof accepts full principal and separately accounted charge',()=>{
 assert.doesNotThrow(()=>verifyFinanceV2TransferAudit(request,accounts,proof()));
});
test('rejects forged after balance, omitted movement and changed charge',()=>{
 const a=proof();a.accountDeltas[0].afterUGX+=1;
 assert.throws(()=>verifyFinanceV2TransferAudit(request,accounts,a),/balance audit mismatch/);
 const b=proof();b.movements.pop();
 assert.throws(()=>verifyFinanceV2TransferAudit(request,accounts,b),/does not match canonical plan/);
 const c=proof();c.externalChargeExpenseUGX=0;
 assert.throws(()=>verifyFinanceV2TransferAudit(request,accounts,c),/does not match canonical plan/);
});
test('rejects misclassified fee and extra account delta',()=>{
 const a=proof();a.movements[2].purpose='PRINCIPAL';
 assert.throws(()=>verifyFinanceV2TransferAudit(request,accounts,a),/movement mismatch/);
 const b=proof();b.accountDeltas.push({accountId:'ghost',beforeUGX:0,deltaUGX:1,afterUGX:1});
 assert.throws(()=>verifyFinanceV2TransferAudit(request,accounts,b),/does not match canonical plan/);
});
test('supports separate charge payer account and prevents unfunded transfer',()=>{
 const input={...request,chargePayerAccountId:'fees'};
 const available=[...accounts,{tenantId:'tenant',accountId:'fees',kind:'PETTY_CASH' as const,balanceUGX:4000,active:true}];
 const p=planFinanceV2Transfer(input,available);
 const aud={accountDeltas:p.accountDeltas.map(d=>{
  const before=available.find(a=>a.accountId===d.accountId)!.balanceUGX;
  return {...d,beforeUGX:before,afterUGX:before+d.deltaUGX};
 }),movements:p.movements.map(m=>({...m})),externalChargeExpenseUGX:p.externalChargeExpenseUGX};
 assert.doesNotThrow(()=>verifyFinanceV2TransferAudit(input,available,aud));
 assert.throws(()=>verifyFinanceV2TransferAudit(input,[...accounts,{...available[2],balanceUGX:999}],aud),/Insufficient funds/);
});
