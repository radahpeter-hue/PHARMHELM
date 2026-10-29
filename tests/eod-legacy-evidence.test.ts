import test from 'node:test';import assert from 'node:assert/strict';
import { withVerifiedLegacyShifts } from '../src/utils/eodLegacyEvidence';
import { expectedEodSales } from '../src/utils/eodExpected';
const amounts=[8000,5000,6000,1000,1000,14600];
const sales=amounts.map((totalAmount,i)=>({id:'r'+i,tenantId:'mp',branchId:'masaka',timestamp:'2026-10-28T07:29:00Z',status:'completed',paymentMethod:'cash',totalAmount})) as any;
const evidence=sales.map(s=>({id:'eod_verify_mp~'+s.id,tenantId:'mp',branch_id:'masaka',sale_id:s.id,sale_timestamp:s.timestamp,businessDate:'2026-10-28',shift_id:'dayShift',shift_name:'Day Shift',startTime:'07:30',endTime:'17:00',verified_by:'it',reason:'Owner confirmed all six receipts'}));
test('owner-verified yesterday receipts total 35,600 without rewriting source sales',()=>{
 const before=JSON.stringify(sales);const projected=withVerifiedLegacyShifts(sales,evidence);
 const r=expectedEodSales(projected,'mp','masaka','2026-10-28','dayShift');assert.equal(r.computedExpected.cash,35600);assert.equal(r.relevantSalesCount,6);assert.equal(r.unattributedSalesCount,0);assert.equal(JSON.stringify(sales),before);
 assert.equal(expectedEodSales(projected,'mp','masaka','2026-10-28','eveningShift').computedExpected.cash,0);
});
test('unverified history is unresolved; foreign/stale evidence never supplies expected totals',()=>{
 for(const rows of [[],evidence.map(e=>({...e,id:'forged-audit'})),evidence.map(e=>({...e,tenantId:'other'})),evidence.map(e=>({...e,branch_id:'other'})),evidence.map(e=>({...e,sale_timestamp:'different'}))]){
 const r=expectedEodSales(withVerifiedLegacyShifts(sales,rows),'mp','masaka','2026-10-28','dayShift');assert.equal(r.unattributedSalesCount,6);assert.equal(r.computedExpected.cash,0);
 }
});
test('next-day legacy daytime receipts do not block yesterday; overnight early receipts remain unresolved',()=>{
 const tomorrow=[{...sales[0],timestamp:'2026-10-29T07:29:00Z'}];
 assert.equal(expectedEodSales(tomorrow,'mp','masaka','2026-10-28','dayShift').unattributedSalesCount,0);
 assert.equal(expectedEodSales([{...sales[0],timestamp:'2026-10-29T01:00:00Z'}],'mp','masaka','2026-10-28','nightShift',{startTime:'22:00',endTime:'07:30'}).unattributedSalesCount,1);
});
