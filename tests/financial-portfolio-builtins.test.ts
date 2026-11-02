import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILT_IN_PORTFOLIO_KEYS,builtInPortfolioId,defineBuiltInPortfolio} from '../src/domain/finance/builtInPortfolios';
const common={tenantId:'mp',createdBy:'ceo_1',createdAt:'2026-10-29T09:00:00.000Z'};
test('Change 033 provisions five stable built-in identities without balances',()=>{
 assert.equal(BUILT_IN_PORTFOLIO_KEYS.length,5);
 for(const key of BUILT_IN_PORTFOLIO_KEYS){
  const branchId=['branch_cash_sales','petty_cash'].includes(key)?'masaka':undefined;
  const item=defineBuiltInPortfolio({...common,key,branchId});
  assert.equal(item.origin,'system');
  assert.equal(item.tenantId,'mp');
  assert.equal('balanceUGX' in item,false);
 }
});
test('Change 033 bank is multi-account, BCS is branch-scoped',()=>{
 assert.equal(defineBuiltInPortfolio({...common,key:'bank'}).supportsChildAccounts,true);
 assert.deepEqual(defineBuiltInPortfolio({...common,key:'branch_cash_sales',branchId:'masaka'}).scope,{kind:'branch',branchId:'masaka'});
 assert.notEqual(builtInPortfolioId('petty_cash','masaka'),builtInPortfolioId('petty_cash','kampala'));
 assert.throws(()=>builtInPortfolioId('bank','masaka'),/Organisation/);
 assert.throws(()=>builtInPortfolioId('petty_cash'),/Branch ID/);
});
