import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBenefitRequest} from '../src/services/hrWelfareSettlement';
import {payrollSnapshot} from '../src/services/hrPayrollApproval';
test('benefit requests validate identities, whole UGX and documented purpose',()=>{
 const input={tenantId:'tenant',id:'claim',staffId:'employee',branchId:'masaka',actorUid:'hr',amountUGX:10000,reason:'Approved medical assistance claim'};
 assert.doesNotThrow(()=>validateBenefitRequest(input));
 for(const patch of [{amountUGX:0},{amountUGX:1.5},{amountUGX:Number.MAX_SAFE_INTEGER+1},{reason:'x'},{reason:'x'.repeat(1001)},{id:'../claim'},{staffId:''}])assert.throws(()=>validateBenefitRequest({...input,...patch}));
});
test('payroll approval identifies advance principal separately from other payable deductions',()=>{
 const input={staffId:'employee',staffName:'Employee',branchId:'masaka',period:'2026-10',baseSalary:100000,bonuses:0,deductions:25000,netSalary:75000,paye:0,nssfEmployee:5000,nssfEmployer:10000,advanceId:'verified-advance',advanceDeduction:20000,fineDeduction:0,unpaidLeaveDeduction:0,reviewed:true};
 const snapshot=payrollSnapshot(input);
 assert.equal(snapshot.advanceId,'verified-advance');assert.equal(snapshot.otherDeductions,0);
 assert.throws(()=>payrollSnapshot({...input,advanceId:''}),/certified disbursement/);
});
