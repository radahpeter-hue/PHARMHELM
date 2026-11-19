import {calculateProfitability} from '../src/domain/finance/profitability';
import test from 'node:test';
import assert from 'node:assert/strict';
import {payrollRecordView} from '../src/domain/finance/payrollRecordView';
const line={staffName:'Employee One',employeeId:'MP-0001',baseSalary:360000,bonuses:10000,
 bonusNotes:'Approved allowance',deductions:41400,advanceDeduction:10000,fineDeduction:2000,
 nssfEmployee:18000,nssfEmployer:36000,paye:11400,netSalary:328600};
test('compact payroll projects authoritative values into existing report and payslip fields',()=>{
 const stored={payrollVersion:11,month:'2026-11',status:'partial',paidUGX:100000,line};
 const view=payrollRecordView(stored) as any;
 assert.equal(view.net_salary,328600);assert.equal(view.netPayable,328600);
 assert.equal(view.gross_salary,370000);assert.equal(view.nssf_employer,36000);
 assert.equal(view.employee_id,'MP-0001');assert.equal(view.year,2026);
 assert.equal(view.status,'partial');assert.equal(view.paidUGX,100000);
 assert.equal('net_salary' in stored,false);assert.equal(view.line,line);
});
test('stale display aliases never override a finalized Level 11 line',()=>{
 const view=payrollRecordView({payrollVersion:11,month:'2026-11',line,net_salary:999999,netPayable:1,nssfEmployer:0});
 assert.equal(view.net_salary,line.netSalary);assert.equal(view.netPayable,line.netSalary);
 assert.equal(view.nssfEmployer,line.nssfEmployer);
});
test('historical payroll passes through without creating liabilities or payment evidence',()=>{
 const legacy={status:'paid',net_salary:500000};
 assert.equal(payrollRecordView(legacy),legacy);assert.equal('paidUGX' in legacy,false);
});

test('P&L recognizes compact authoritative lines only for the approved current revision',()=>{
 const row={id:'employee',tenantId:'tenant',payrollVersion:11,batchId:'batch',revision:2,staffId:'employee',branch_id:'masaka',periodStart:'2026-11-01',periodEnd:'2026-11-30',line,status:'pending_finance'};
 for(const status of ['draft','pending_finance','returned','approved','partial','paid']){
  const report=calculateProfitability({payroll:[row],finance_payroll_batches_v1:[{id:'batch',tenantId:'tenant',revision:2,status}]},{tenantId:'tenant'});
  assert.equal(report.totals.payroll,['approved','partial','paid'].includes(status)?406000:0);
 }
});
