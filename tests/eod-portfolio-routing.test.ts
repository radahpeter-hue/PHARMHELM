import test from 'node:test';
import assert from 'node:assert/strict';
import {planEodPortfolioRouting} from '../src/domain/finance/eodPortfolioRouting';

const base={tenantId:'martin',branchId:'masaka',reconciliationId:'eod~martin~masaka~2026-11-02~dayShift',actual:{cash:1000,momo:2000,airtel:3000,card:4000}};
test('EOD routes each channel and retains source branch and deterministic identity',()=>{
 const plan=planEodPortfolioRouting({...base,cardBankPortfolioId:'bank_001'});
 assert.deepEqual(plan.map(x=>x.accountId),['system_branch_cash_sales_masaka','system_mtn_mobile_money','system_airtel_mobile_money','bank_001']);
 assert.deepEqual(plan.map(x=>x.amountUGX),[1000,2000,3000,4000]);
 assert.ok(plan.every(x=>x.branchId==='masaka'&&x.reconciliationId===base.reconciliationId));
 assert.deepEqual(plan,planEodPortfolioRouting({...base,cardBankPortfolioId:'bank_001'}));
});
test('unconfigured card destination fails closed if card amount is nonzero',()=>{
 assert.throws(()=>planEodPortfolioRouting(base),/no configured branch/);
});
test('zero card requires no bank and zero amounts create no artificial movements',()=>{
 const x=planEodPortfolioRouting({...base,actual:{cash:1,momo:0,airtel:0,card:0}});
 assert.equal(x.length,1);assert.equal(x[0].channel,'cash');
});
test('unsafe EOD monetary values are rejected',()=>{
 assert.throws(()=>planEodPortfolioRouting({...base,cardBankPortfolioId:'bank_001',actual:{...base.actual,cash:-3}}));
});
