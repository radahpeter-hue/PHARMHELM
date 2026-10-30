import test from 'node:test';
import assert from 'node:assert/strict';
import {projectEodChannelEvidence} from '../src/domain/finance/portfolioEodEvidence';
import {eodIdentity} from '../src/utils/eodShifts';
const tenantId='mp',branchId='masaka',day='2026-10-30',shift='morning';
const id=eodIdentity(tenantId,branchId,day,shift);
const row={tenantId,branch_id:branchId,reconciliation_date:day,shift_id:shift,
 audit_only:true,financial_posting:'none',cash_actual:1000,cash_expected:950,cash_variance:50,
 momo_actual:200,momo_expected:200,momo_variance:0,
 airtel_actual:500,airtel_expected:500,airtel_variance:0};
test('EOD channels remain reconciliation evidence, never funding or deposit postings',()=>{
 const cash=projectEodChannelEvidence(id,row,tenantId,branchId,'cash');
 assert.equal(cash.declaredUGX,1000);assert.equal(cash.fundingPosted,false);
 const momo=projectEodChannelEvidence(id,row,tenantId,branchId,'momo');
 assert.equal(momo.declaredUGX,200);assert.equal(momo.fundingPosted,false);
});
test('EOD evidence fails closed on identity, scope, totals or posting contamination',()=>{
 assert.throws(()=>projectEodChannelEvidence(id,{...row,branch_id:'another'},tenantId,branchId,'cash'),/mismatch/);
 assert.throws(()=>projectEodChannelEvidence(id,{...row,cash_variance:0},tenantId,branchId,'cash'),/totals/);
 assert.throws(()=>projectEodChannelEvidence(id,{...row,financial_posting:'posted'},tenantId,branchId,'cash'),/not be counted/);
});
