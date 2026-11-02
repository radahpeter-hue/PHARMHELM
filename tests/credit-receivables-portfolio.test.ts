import test from 'node:test';
import assert from 'node:assert/strict';
import {projectCreditReceivables} from '../src/domain/finance/creditReceivablesPortfolio';
const row={id:'debt1',tenantId:'tenant_a',receipt_id:'sale1',amount_ugx:1000,outstanding_ugx:400,client_name:'Institution A',branch_id:'masaka',created_at:'2026-11-02T08:00:00Z',status:'outstanding'};
test('receivables total uses current outstanding, not original credit or repayments added again',()=>{
 const p=projectCreditReceivables('tenant_a',[row],[{id:'payment1',tenantId:'tenant_a',receivableId:'debt1',fromPortfolio:'receivables',amount:600,processedAt:'2026-11-02T10:00:00Z'}]);
 assert.equal(p.totalOutstandingUGX,400);assert.equal(p.repayments.length,1);assert.equal(p.rows[0].branchId,'masaka');
});
test('paid and legacy uncollected obligations preserve zero and original amount respectively',()=>{
 const p=projectCreditReceivables('tenant_a',[{...row,status:'paid',outstanding_ugx:0},{...row,id:'legacy',receipt_id:'',outstanding_ugx:undefined}]);
 assert.equal(p.totalOutstandingUGX,1000);
});
test('duplicate document or sale reference makes balance unavailable instead of counting debt twice',()=>{
 assert.throws(()=>projectCreditReceivables('tenant_a',[row,row]),/Duplicate/);
 assert.throws(()=>projectCreditReceivables('tenant_a',[row,{...row,id:'copy'}]),/same sale/);
});
test('tenant mixing, invalid money and inconsistent paid balances fail closed',()=>{
 for(const changes of [{tenantId:'other'},{amount_ugx:'1000'},{outstanding_ugx:-1},{outstanding_ugx:1001},{status:'paid'}])assert.throws(()=>projectCreditReceivables('tenant_a',[{...row,...changes}]));
});
test('unknown historical payments are not manufactured from amount minus outstanding',()=>{
 const p=projectCreditReceivables('tenant_a',[row]);assert.equal(p.repayments.length,0);assert.equal(p.totalOutstandingUGX,400);
});
test('only payments linked to saved debts appear and duplicates are rejected',()=>{
 const payment={id:'p',tenantId:'tenant_a',receivableId:'debt1',fromPortfolio:'receivables',amount:600};
 assert.equal(projectCreditReceivables('tenant_a',[row],[{...payment,receivableId:'unknown'}]).repayments.length,0);
 assert.throws(()=>projectCreditReceivables('tenant_a',[row],[payment,payment]),/Invalid/);
});
test('empty saved ledger is zero and no synthetic credit obligation is introduced',()=>assert.equal(projectCreditReceivables('tenant_a',[]).totalOutstandingUGX,0));
