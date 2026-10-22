import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSalarySettlement} from '../src/services/financeV2Disbursement';
const input={tenantId:'tenant',payrollId:'tenant_staff_2026-10',requestId:'request',accountId:'bank',actorUid:'finance',amountUGX:1000,chargeUGX:10,externalReference:'BANK-001',recipientReference:'Verified employee bank',paymentDate:'2026-10-22'};
test('salary principal and charge validation preserves whole UGX and distinct references',()=>{
 assert.doesNotThrow(()=>validateSalarySettlement(input));
 for(const changes of [{amountUGX:1.5},{amountUGX:0},{chargeUGX:-1},{amountUGX:Number.MAX_SAFE_INTEGER,chargeUGX:1},{externalReference:''},{recipientReference:''},{paymentDate:'bad'},{paymentDate:'2026-02-31'},{externalReference:'lowercase-ref'},{accountId:'../bank'}])assert.throws(()=>validateSalarySettlement({...input,...changes}));
});

import {validateOpening} from '../src/services/financeV2Opening';
test('verified account opening validates safe amounts and documentary evidence',()=>{
 const value={tenantId:'tenant',accountId:'bank',actorUid:'finance',amountUGX:10000,externalReference:'OPENING-001',evidence:'Reconciled test bank statement'};
 assert.doesNotThrow(()=>validateOpening(value));
 for(const changes of [{amountUGX:0},{amountUGX:1.5},{amountUGX:Number.MAX_SAFE_INTEGER+1},{evidence:'none'},{externalReference:'lowercase'},{accountId:'../bank'}])assert.throws(()=>validateOpening({...value,...changes}));
});
