import test from 'node:test';
import assert from 'node:assert/strict';
import {defineBuiltInPortfolio} from '../src/domain/finance/builtInPortfolios';
import {canDeleteUnusedFinancialObject,canDeactivateFinancialObject,deactivatePortfolio,reactivatePortfolio,assertUnusedPortfolioCanBeDeleted,assertUnusedChildAccountCanBeDeleted,type LifecycleEvidence} from '../src/domain/finance/portfolioLifecycle';
const zero:LifecycleEvidence={ledgerEntryCount:0,transferCount:0,dependentRecordCount:0,openingBalanceUGX:0,currentBalanceUGX:0,childMovementCount:0};
const systemPortfolio=defineBuiltInPortfolio({tenantId:'mp',key:'bank',createdBy:'ceo',createdAt:'2026-10-29T09:00:00Z'});
const p={...systemPortfolio,origin:'custom' as const};
test('Changes 048-055 refuse deletion of used portfolios even after transfers emptied balance',()=>{
 assert.equal(canDeleteUnusedFinancialObject(zero),true);
 assert.equal(canDeleteUnusedFinancialObject({...zero,ledgerEntryCount:1}),false);
 assert.equal(canDeleteUnusedFinancialObject({...zero,transferCount:1}),false);
 assert.equal(canDeactivateFinancialObject({...zero,currentBalanceUGX:100000}),false);
 assert.throws(()=>deactivatePortfolio(p,'ceo','2026-10-29T10:00:00Z','fund closure',{...zero,currentBalanceUGX:1}),/non-zero/);
});
test('Changes 048-055 reactivate same portfolio identity and ledger association',()=>{
 const inactive=deactivatePortfolio(p,'ceo','2026-10-29T10:00:00Z','test',zero);
 assert.equal(inactive.id,p.id);
 assert.equal(inactive.deactivatedBy,'ceo');
 const active=reactivatePortfolio(inactive,'ceo','2026-10-29T11:00:00Z');
 assert.equal(active.id,p.id);
 assert.equal(active.status,'active');
 assert.equal(active.deactivatedAt,undefined);
});

test('Built-in system portfolios cannot be disabled through custom lifecycle',()=>{
 assert.throws(()=>deactivatePortfolio(systemPortfolio,'ceo','2026-10-29T10:00:00Z','closure',zero),/System portfolios/);
});

test('Changes 051 and 055 hard deletion is forbidden for system objects and historical movements',()=>{
 const account={id:'eq_ops',tenantId:'mp',portfolioId:p.id,displayName:'Equity operating',institution:'Equity',accountReference:'1234',currency:'UGX' as const,scope:{kind:'organisation' as const},status:'active' as const,createdBy:'ceo',createdAt:'2026-10-29T09:00:00Z'};
 assert.doesNotThrow(()=>assertUnusedPortfolioCanBeDeleted(p,zero));
 assert.doesNotThrow(()=>assertUnusedChildAccountCanBeDeleted(account,zero));
 assert.throws(()=>assertUnusedPortfolioCanBeDeleted(systemPortfolio,zero),/Built-in/);
 assert.throws(()=>assertUnusedPortfolioCanBeDeleted(p,{...zero,childMovementCount:1}),/history/);
 assert.throws(()=>assertUnusedChildAccountCanBeDeleted(account,{...zero,transferCount:1}),/history/);
 assert.throws(()=>assertUnusedChildAccountCanBeDeleted(account,{...zero,currentBalanceUGX:-1}),/history/);
 assert.throws(()=>assertUnusedChildAccountCanBeDeleted(account,{...zero,ledgerEntryCount:NaN}),/Incomplete/);
});
