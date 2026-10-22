import assert from 'node:assert/strict';
import { requestPayrollVoid, voidUnpaidPayroll } from '../src/services/hrPayrollCorrection.ts';
import { attestPayroll } from '../src/services/hrPayrollApproval.ts';
import { finalizePayrollDraft } from '../src/services/hrPayrollFinalization.ts';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore';

const projectId = 'phase5-advance-rules';
const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules: readFileSync('firestore.rules', 'utf8') }
});
const request = {
  tenantId: 'tenant-a',
  staffId: 'employee',
  staff_id: 'employee',
  amount: 100000,
  amountRequested: 100000,
  amount_requested: 100000,
  reason: 'Personal advance',
  repayment_period_months: 3,
  status: 'Pending',
  hr_approval_status: 'Pending',
  ceo_approval_status: 'Pending'
};
const employee = env.authenticatedContext('employee', { tenantId: 'tenant-a', role: 'Employee' }).firestore();
const hr = env.authenticatedContext('hr', { tenantId: 'tenant-a', role: 'HR Head' }).firestore();
const logger = env.authenticatedContext('logger', { tenantId: 'tenant-a', role: 'HR Support Personnel' }).firestore();
const ceo = env.authenticatedContext('ceo', { tenantId: 'tenant-a', role: 'CEO' }).firestore();
const outsider = env.authenticatedContext('outsider', { tenantId: 'tenant-b', role: 'Finance Head' }).firestore();
const advance = doc(employee, 'advance_requests', 'advance-test');
try {
  await env.withSecurityRulesDisabled(async admin => {
    for (const [uid, role] of [['hr','HR Head'], ['finance','Finance Head'], ['employee','Employee'], ['outsider','Finance Head']]) {
      await setDoc(doc(admin.firestore(),'staff',uid), {tenantId:uid === 'outsider' ? 'tenant-b':'tenant-a',role,branch_id:'b1',assigned_branches:['b1']});
    }
  });
  await assertSucceeds(setDoc(advance, request));
  await assertFails(updateDoc(advance, { status: 'Disbursed' }));
  await assertFails(setDoc(doc(employee, 'advance_requests', 'forged'), { ...request, status: 'Approved' }));
  await assertFails(setDoc(doc(employee, 'advance_requests', 'negative'), { ...request, amount: -5, amountRequested: -5, amount_requested: -5 }));
  await assertFails(setDoc(doc(outsider, 'advance_requests', 'other-tenant'), { ...request, staffId: 'outsider', staff_id: 'outsider' }));
  await assertFails(updateDoc(doc(outsider, 'advance_requests', 'advance-test'), { status: 'Rejected' }));
  await assertSucceeds(updateDoc(doc(hr, 'advance_requests', 'advance-test'), { hr_approval_status: 'Approved', hr_notes: 'Reviewed', hr_reviewed_by: 'hr' }));
  await assertFails(updateDoc(doc(hr, 'advance_requests', 'advance-test'), { status: 'Approved', amount_requested: 200000 }));
  await assertFails(updateDoc(doc(hr, 'advance_requests', 'advance-test'), { status: 'Disbursed' }));
  await assertFails(updateDoc(doc(hr, 'advance_requests', 'advance-test'), { ceo_approval_status: 'Approved', ceo_reviewed_by: 'hr', status: 'Approved' }));
  await assertSucceeds(updateDoc(doc(ceo, 'advance_requests', 'advance-test'), { ceo_approval_status: 'Approved', ceo_notes: 'Approved', ceo_reviewed_by: 'ceo', status: 'Approved' }));
  await assertFails(updateDoc(doc(ceo, 'advance_requests', 'advance-test'), { amount_requested: 200000 }));
  await assertFails(setDoc(doc(hr, 'payroll', 'fake-paid'), { tenantId: 'tenant-a', staffId: 'employee', status: 'paid', net_salary: 100000 }));
  await assertFails(setDoc(doc(hr, 'payslips', 'fake-paid'), { tenantId: 'tenant-a', staffId: 'employee', netPayable: 100000 }));
  console.log('Advance approval and payroll write denials validated; checking attendance.');
  const timesheet = {
    tenantId: 'tenant-a', staffId: 'employee', staff_name: 'Test Employee',
    branch_id: 'b1', date: '2026-10-20', status: 'present', hours_worked: 8,
    check_in_time: '08:00', check_out_time: '16:00',
    loggedByUid: 'logger', approval_status: 'Submitted'
  };
  await assertSucceeds(setDoc(doc(logger, 'attendance', 'tenant-a_employee_2026-10-20'), timesheet));
  await assertFails(setDoc(doc(logger, 'attendance', 'tenant-a_employee_2026-10-21'), { ...timesheet, date: '2026-10-21', approval_status: 'Approved' }));
  await assertFails(updateDoc(doc(logger, 'attendance', 'tenant-a_employee_2026-10-20'), { approval_status: 'Approved', approvedByUid: 'logger' }));
  console.log('Attendance submitted; checking independent HR approval.');
  await assertSucceeds(updateDoc(doc(hr, 'attendance', 'tenant-a_employee_2026-10-20'), { approval_status: 'Approved', approvedByUid: 'hr' }));
  await assertFails(updateDoc(doc(hr, 'attendance', 'tenant-a_employee_2026-10-20'), { hours_worked: 10 }));
  await assertFails(updateDoc(doc(hr, 'attendance', 'tenant-a_employee_2026-10-20'), { approval_status: 'Submitted' }));
  await assertSucceeds(getDoc(doc(hr, 'advance_requests', 'advance-test')));
  console.log('Attendance approval and immutable-history denials validated; checking privacy.');
  await env.withSecurityRulesDisabled(async admin => {
    await setDoc(doc(admin.firestore(), 'payroll', 'other-payroll'), {
      tenantId: 'tenant-a', staffId: 'other-employee', net_salary: 500000, status: 'approved_unpaid'
    });
    await setDoc(doc(admin.firestore(), 'payslips', 'other-payslip'), {
      tenantId: 'tenant-a', staffId: 'other-employee', netPayable: 500000
    });
  });
  await assertFails(getDoc(doc(employee, 'payroll', 'other-payroll')));
  await assertFails(getDoc(doc(employee, 'payslips', 'other-payslip')));
  await assertFails(getDoc(doc(outsider, 'payroll', 'other-payroll')));
  await assertSucceeds(getDoc(doc(hr, 'payroll', 'other-payroll')));
  const finance = env.authenticatedContext('finance', {tenantId:'tenant-a',role:'Finance Head'}).firestore();
  const id = 'tenant-a_employee_2026-10';
  const snapshot = {staffId:'employee',staffName:'Test Employee',branchId:'b1',period:'2026-10',
    baseSalary:500000,bonuses:0,deductions:100000,netSalary:400000,paye:75000,
    nssfEmployee:25000,nssfEmployer:50000,advanceDeduction:0,fineDeduction:0,unpaidLeaveDeduction:0,otherDeductions:0};
  const common = {tenantId:'tenant-a',staffId:'employee',staff_name:'Test Employee',branch_id:'b1',month:'2026-10',
    period:'2026-10',payrollId:id,finalizedBy:'finance',finalizedAt:serverTimestamp(),status:'approved_unpaid',
    snapshot,approvalRevision:1,hrApprovedBy:'hr',
    baseSalary:500000,base_salary:500000,bonuses:0,deductions:100000,netSalary:400000,net_salary:400000,
    paye:75000,nssfEmployee:25000,nssfEmployer:50000,nssf_employee:25000,nssf_employer:50000,
    advanceDeduction:0,advance_deduction:0,fineDeduction:0,fine_deduction:0,unpaidLeaveDeduction:0,
    salaryExpenseUGX:500000,employerNssfExpenseUGX:50000,payePayableUGX:75000,nssfPayableUGX:75000,
    otherDeductionsPayableUGX:0,netSalaryPayableUGX:400000,accountingReference:id};
  const payrollInput = {...common};
  const payslipInput = {...common,netPayable:400000,basePay:500000,allowances:0,year:2026};
  const pair = (connection, payroll = payrollInput, payslip = payslipInput) => {
    const batch = writeBatch(connection);
    batch.set(doc(connection,'payroll',id),payroll);
    batch.set(doc(connection,'payslips',id),payslip);
    batch.set(doc(connection,'payroll',id,'state','current'),{tenantId:'tenant-a',snapshot,paidUGX:0,outstandingUGX:400000,voided:false,lastAction:'recognition',updatedAt:serverTimestamp()});
    return batch.commit();
  };
  await assertFails(pair(finance)); // Finance cannot invent an HR signature.
  const approval = {tenantId:'tenant-a',snapshot,revision:1,status:'approved',approvedBy:'hr',approvedAt:serverTimestamp(),reason:'Validated remuneration'};
  const approve = (connection, value = approval) => {
    const batch = writeBatch(connection);
    batch.set(doc(connection,'payroll_approvals',id),value);
    batch.set(doc(connection,'payroll_approvals',id,'revisions',String(value.revision)),value);
    return batch.commit();
  };
  await assertFails(approve(finance, {...approval,approvedBy:'finance'}));
  await assertFails(approve(outsider, {...approval,approvedBy:'outsider'}));
  await assertFails(approve(hr, {...approval,snapshot:{...snapshot,advanceDeduction:1}}));
  await assertSucceeds(approve(hr));
  const rejection = {...approval, revision:2, status:'rejected'};
  await assertSucceeds(approve(hr, rejection));
  await assertFails(pair(finance));
  const superseded = {...approval, revision:3, status:'superseded'};
  await assertSucceeds(approve(hr, superseded));
  await assertFails(pair(finance));
  await assertSucceeds(approve(hr, {...approval,revision:4}));
  payrollInput.approvalRevision = 4;
  payslipInput.approvalRevision = 4;

  await assertFails(pair(hr,{...payrollInput,finalizedBy:'hr'},{...payslipInput,finalizedBy:'hr'}));
  await assertFails(pair(finance,{...payrollInput,netSalary:1,net_salary:1}));
  await assertFails(pair(finance,{...payrollInput,salaryExpenseUGX:1}));
  await assertFails(pair(finance,{...payrollInput,branch_id:'other'}));
  await assertFails(updateDoc(doc(hr,'payroll_approvals',id,'revisions','1'),{status:'rejected'}));
  const forgedBatch = writeBatch(finance);
  forgedBatch.set(doc(finance,'payroll',id),payrollInput);
  forgedBatch.set(doc(finance,'payslips',id),{...payslipInput,staffId:'other-employee'});
  await assertFails(forgedBatch.commit());
  await assertFails(setDoc(doc(finance,'payroll',id),payrollInput));
  await assertFails(setDoc(doc(finance,'payslips',id),payslipInput));
  const batch = writeBatch(finance);
  batch.set(doc(finance,'payroll',id),payrollInput);
  batch.set(doc(finance,'payslips',id),payslipInput);
  batch.set(doc(finance,'payroll',id,'state','current'),{tenantId:'tenant-a',snapshot,paidUGX:0,outstandingUGX:400000,voided:false,lastAction:'recognition',updatedAt:serverTimestamp()});
  await assertSucceeds(batch.commit());
  await assertFails(approve(hr, {...approval,revision:2}));
  await assertFails(setDoc(doc(finance,'payroll',id),payrollInput));
  await assertFails(updateDoc(doc(finance,'payroll',id),{netSalary:1}));
  await assertFails(updateDoc(doc(finance,'payslips',id),{netPayable:1}));
  await assertFails(setDoc(doc(outsider,'payroll','tenant-b_employee_2026-10'),{...payrollInput,tenantId:'tenant-b',payrollId:'tenant-b_employee_2026-10'}));
  // Exercise actual production services, including missing-record reads and transactions.
  const serviceRecord = {...snapshot, period:'2026-11', reviewed:true};
  await assertSucceeds(attestPayroll({tenantId:'tenant-a',actorUid:'hr',records:[serviceRecord]},hr));
  await assertSucceeds(finalizePayrollDraft({tenantId:'tenant-a',actorUid:'finance',records:[serviceRecord]},finance));
  await assert.rejects(finalizePayrollDraft({tenantId:'tenant-a',actorUid:'finance',records:[serviceRecord]},finance), /already finalized/);
  const posted = (await getDoc(doc(finance,'payroll','tenant-a_employee_2026-11'))).data();
  if (posted.netSalaryPayableUGX !== 400000 || posted.salaryExpenseUGX + posted.employerNssfExpenseUGX !==
      posted.netSalaryPayableUGX + posted.payePayableUGX + posted.nssfPayableUGX + posted.otherDeductionsPayableUGX)
    throw new Error('Salary accrual does not reconcile');
  const voidInput = {payrollId:'tenant-a_employee_2026-11',actorUid:'hr',reason:'Incorrect employee remuneration'};
  await assertFails(requestPayrollVoid({...voidInput,actorUid:'finance'},finance));
  await assertSucceeds(requestPayrollVoid(voidInput,hr));
  await assert.rejects(voidUnpaidPayroll({...voidInput,actorUid:'hr'},hr));
  await assertSucceeds(voidUnpaidPayroll({...voidInput,actorUid:'finance'},finance));
  await assert.rejects(voidUnpaidPayroll({...voidInput,actorUid:'finance'},finance));
  const reversed = (await getDoc(doc(finance,'payroll',voidInput.payrollId,'corrections','void'))).data();
  assert.equal(reversed.netSalaryPayableUGX + posted.netSalaryPayableUGX, 0);
  assert.equal(reversed.salaryExpenseUGX + posted.salaryExpenseUGX, 0);
  await assertFails(updateDoc(doc(finance,'payroll',voidInput.payrollId,'corrections','void'),{reason:'erase evidence'}));
  console.log('Atomic payroll + payslip creates allowed together, single writes and mutation denied');
  console.log('Phase 5 HR privacy, approvals and forbidden payroll writes: PASS');
} finally {
  await env.cleanup();
}
