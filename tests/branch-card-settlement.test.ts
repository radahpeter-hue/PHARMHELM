import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCardSettlementTarget} from '../src/domain/finance/branchCardSettlement';
import type {FinancialPortfolio} from '../src/domain/finance/financialPortfolio';

const account={
 tenantId:'mp',id:'bank_account_1',origin:'custom',classification:'bank',
 bankParentId:'system_bank',scope:{kind:'organisation'},status:'active'
} as FinancialPortfolio;

test('active registered tenant bank is an eligible card settlement target',()=>{
 assert.doesNotThrow(()=>validateCardSettlementTarget('masaka','mp',account));
});

test('card settlement routing cannot target another tenant, a branch wallet, inactive bank or bank parent',()=>{
 for(const invalid of [
  {...account,tenantId:'other'},
  {...account,status:'inactive'},
  {...account,classification:'mobile_money'},
  {...account,bankParentId:undefined},
  {...account,scope:{kind:'branch',branchId:'masaka'}}
 ]){
  assert.throws(()=>validateCardSettlementTarget('masaka','mp',invalid as FinancialPortfolio));
 }
 assert.throws(()=>validateCardSettlementTarget('','mp',account));
});
