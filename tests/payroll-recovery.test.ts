import test from 'node:test';
import assert from 'node:assert/strict';
import {payrollMonthStart,payrollMonthEnd,payrollSummary,legacyRejectedPayroll,validatePayrollPeriod,payrollOverlap} from '../src/domain/finance/payrollRecovery';
test('Kampala month defaults do not slip into the preceding UTC day',()=>{
 assert.equal(payrollMonthStart(new Date('2026-10-31T22:00:00Z')),'2026-11-01');
 assert.equal(payrollMonthEnd(new Date('2028-02-10T00:00:00Z')),'2028-02-29');
 assert.throws(()=>validatePayrollPeriod('2026-02-30','2026-03-01'));
});
test('only approved obligations and recorded Level 11 settlements enter payable/paid totals',()=>{
 const rows=[['pending_finance',100,0],['returned',200,0],['approved',300,0],['partial',400,150],['paid',500,500],['draft',700,0]].map(([status,net,paidUGX])=>({status,totals:{net},paidUGX}));
 assert.deepEqual(payrollSummary(rows,[{net_salary:5300899.038,status:'paid'},{payrollVersion:11,net_salary:123}]),{pending:100,returned:200,outstanding:550,paid:650,legacy:5300899.038});
});
test('overlap includes inclusive boundaries and returned reservations, excludes the same correction',()=>{
 const b={id:'one',periodStart:'2026-11-01',periodEnd:'2026-11-30',status:'paid'};
 for(const status of ['draft','pending_finance','returned','approved','partial','paid'])assert.ok(payrollOverlap('2026-11-30','2026-12-02',[{...b,status}]));
 assert.equal(payrollOverlap('2026-12-01','2026-12-31',[b]),undefined);
 assert.equal(payrollOverlap('2026-11-01','2026-11-30',[b],'one'),undefined);
});
test('legacy recovery lists only rejected payroll expenses, not unrelated HR or Level 11 requests',()=>{
 const e={id:'legacy',source:'hr_salary',status:'Rejected'};
 assert.deepEqual(legacyRejectedPayroll([e,{...e,payrollVersion:11},{...e,source:'advance',sourceType:'hr'},{...e,status:'approved'}]),[e]);
});
