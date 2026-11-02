import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeBranchContributions} from '../src/domain/finance/portfolioBranchContributions';
import type {FinancialLedgerEntry} from '../src/domain/finance/portfolioLedger';
function record(id:string,branchId:string|undefined,amountUGX:number,direction:'inflow'|'outflow'='inflow'):FinancialLedgerEntry{
 return {id,tenantId:'tenant_a',portfolioId:'system_mtn_mobile_money',
  businessDate:'2026-11-02',occurredAt:'2026-11-02T10:00:00Z',
  reference:id,description:'EOD collection',source:'banking_records',
  direction,amountUGX,actorId:'finance_a',status:'posted',branchId};
}
test('consolidated branch inflows sum once without duplicating shared bank balances',()=>{
 const s=summarizeBranchContributions([record('a','masaka',200),record('b','kampala',500),
  record('c','masaka',100),record('d','masaka',50,'outflow'),record('x',undefined,70)]);
 assert.deepEqual(s.branches.map(x=>[x.branchId,x.inflowUGX,x.netUGX]),[
  ['kampala',500,500],['masaka',300,250]]);
 assert.equal(s.attributedInflowUGX,800);
 assert.equal(s.unattributedUGX,70);
});
test('invalid movements fail closed',()=>{
 assert.throws(()=>summarizeBranchContributions([record('bad','masaka',-5)]));
});
