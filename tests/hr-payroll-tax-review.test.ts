import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewedPayrollTaxes,validPayrollTaxAttestationReason} from '../src/services/hrPayrollTaxReview';
const input={treatment:'',grossUGX:500000,periodEnd:'2026-10-31',nssfEligible:true,reason:'Verified assessment evidence TAX-123',paye:12345,employee:0,employer:0};
test('unknown employment tax treatment is not silently treated as resident primary',()=>{
 for(const treatment of ['', 'Full-Time','Part-Time','consultant','nonresident','secondary'])assert.throws(()=>reviewedPayrollTaxes({...input,treatment}),/Select verified/);
});
test('independent HR statutory attestation must identify the reviewed treatment',()=>{
 assert.equal(validPayrollTaxAttestationReason('Reviewed remuneration and deductions'),false);
 assert.equal(validPayrollTaxAttestationReason('Resident primary employment verified.'),false);
 for(const treatment of ['resident_primary','documented_manual'])assert.equal(validPayrollTaxAttestationReason(reviewedPayrollTaxes({...input,treatment}).note),true);
});
test('explicit resident primary assessment retains dated policy and eligible NSSF',()=>{
 const result=reviewedPayrollTaxes({...input,treatment:'resident_primary'});
 assert.deepEqual({paye:result.paye,employee:result.employee,employer:result.employer},{paye:38250,employee:25000,employer:50000});
 assert.match(result.note,/Resident primary employment verified/);
 assert.equal(reviewedPayrollTaxes({...input,treatment:'resident_primary',nssfEligible:false}).employer,0);
});
test('documented nonresident consultant or secondary assessment is retained without resident recomputation',()=>{
 const result=reviewedPayrollTaxes({...input,treatment:'documented_manual',reason:'Finance reviewed secondary employment assessment TAX-456'});
 assert.equal(result.paye,12345);assert.equal(result.employee,0);assert.equal(result.employer,0);
 assert.match(result.note,/TAX-456/);
 assert.throws(()=>reviewedPayrollTaxes({...input,treatment:'documented_manual',reason:''}),/Document tax residence/);
 for(const value of [-1,1.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>reviewedPayrollTaxes({...input,treatment:'documented_manual',employer:value}),/whole-number/);
});
