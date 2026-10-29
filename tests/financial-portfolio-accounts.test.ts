import test from 'node:test';
import assert from 'node:assert/strict';
import {defineBuiltInPortfolio} from '../src/domain/finance/builtInPortfolios';
import {assertUniqueBankAccount,validatePortfolioChildAccount,type PortfolioChildAccount} from '../src/domain/finance/portfolioAccounts';
const p=defineBuiltInPortfolio({tenantId:'mp',key:'bank',createdBy:'ceo',createdAt:'2026-10-29T09:00:00Z'});
const a:PortfolioChildAccount={id:'eq_ops',tenantId:'mp',portfolioId:p.id,displayName:'Equity operating',accountReference:'123 456',institution:'Equity',currency:'UGX',scope:{kind:'organisation'},status:'active',createdBy:'ceo',createdAt:'2026-10-29T09:00:00Z'};
test('Changes 042-047 validate nested accounts and exact bank identity',()=>{
 assert.equal(validatePortfolioChildAccount(a,p).id,'eq_ops');
 assert.doesNotThrow(()=>assertUniqueBankAccount({...a,id:'eq_payroll',accountReference:'789123'},[a]));
 assert.throws(()=>assertUniqueBankAccount({...a,id:'eq_payroll',accountReference:'123-456'},[a]),/Duplicate/);
 assert.throws(()=>validatePortfolioChildAccount({...a,tenantId:'foreign'},p),/scope/);
 const bcs=defineBuiltInPortfolio({tenantId:'mp',key:'branch_cash_sales',branchId:'masaka',createdBy:'ceo',createdAt:'2026-10-29T09:00:00Z'});
 assert.throws(()=>validatePortfolioChildAccount({...a,portfolioId:bcs.id},bcs),/does not permit/);
});
