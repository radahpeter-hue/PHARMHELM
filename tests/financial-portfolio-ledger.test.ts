import test from 'node:test';
import assert from 'node:assert/strict';
import {defineBuiltInPortfolio} from '../src/domain/finance/builtInPortfolios';
import {defaultLedgerQuery,filterFinancialLedger,consolidatedAccountBalance,projectLedgerWithRunningBalances,assertPortfolioAccountCoverage,type FinancialLedgerEntry} from '../src/domain/finance/portfolioLedger';
const p=defineBuiltInPortfolio({tenantId:'mp',key:'bank',createdBy:'ceo_1',createdAt:'2026-10-29T09:00:00Z'});
const row=(id:string,date:string,direction:'inflow'|'outflow',tenantId='mp'):FinancialLedgerEntry=>({
 id,tenantId,portfolioId:p.id,businessDate:date,occurredAt:date+'T08:00:00Z',reference:id,
 description:id,source:'test',direction,amountUGX:100,actorId:'actor',status:'posted'
});
test('Change 038 default ledger covers inclusive current day and prior 2 dates',()=>{
 assert.deepEqual(defaultLedgerQuery('2026-10-29'),{from:'2026-10-27',to:'2026-10-29',direction:'all'});
 assert.equal(defaultLedgerQuery('2026-03-01').from,'2026-02-27');
});
test('Changes 037 and 039 filter by tenant, portfolio, date and direction',()=>{
 const entries=[row('b','2026-10-29','outflow'),row('a','2026-10-28','inflow'),row('c','2026-10-29','inflow','foreign'),row('d','2026-10-25','inflow')];
 assert.deepEqual(filterFinancialLedger(entries,p,defaultLedgerQuery('2026-10-29')).map(x=>x.id),['a','b']);
 assert.deepEqual(filterFinancialLedger(entries,p,{from:'2026-10-27',to:'2026-10-29',direction:'outflow'}).map(x=>x.id),['b']);
});
test('Changes 040-041 consolidate only valid child account balances',()=>{
 assert.equal(consolidatedAccountBalance([{tenantId:'mp',portfolioId:p.id,accountId:'eq',balanceUGX:20},{tenantId:'mp',portfolioId:p.id,accountId:'stan',balanceUGX:10},{tenantId:'other',portfolioId:p.id,accountId:'f',balanceUGX:1000}],p),30);
 assert.throws(()=>consolidatedAccountBalance([{tenantId:'mp',portfolioId:p.id,accountId:'eq',balanceUGX:1},{tenantId:'mp',portfolioId:p.id,accountId:'eq',balanceUGX:2}],p),/Duplicate/);
});

test('Changes 040-041 maintain full-history running balance without counting reversed originals twice',()=>{
 const posted=row('a','2026-10-27','inflow');
 const reversed={...row('b','2026-10-28','outflow'),status:'reversed' as const};
 const projected=projectLedgerWithRunningBalances([reversed,posted],250);
 assert.deepEqual(projected.map(x=>x.runningBalanceUGX),[350,350]);
 assert.throws(()=>projectLedgerWithRunningBalances([posted,posted],0),/duplicate/);
 assert.throws(()=>projectLedgerWithRunningBalances([posted],NaN),/opening balance/);
});
test('Change 046 refuses incomplete child balance coverage instead of assuming missing bank funds are zero',()=>{
 const balances=[{tenantId:'mp',portfolioId:p.id,accountId:'equity',balanceUGX:100}];
 assert.throws(()=>assertPortfolioAccountCoverage(['equity','stanbic'],balances,p),/incomplete/);
 assert.equal(assertPortfolioAccountCoverage(['equity'],balances,p),100);
});
