import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

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
  const common = {tenantId:'tenant-a',staffId:'employee',period:'2026-10',payrollId:id,finalizedBy:'finance',status:'approved_unpaid'};
  const payrollInput = {...common,baseSalary:500000,bonuses:0,deductions:100000,netSalary:400000};
  const payslipInput = {...common,netPayable:400000};
  const forgedBatch = writeBatch(finance);
  forgedBatch.set(doc(finance,'payroll',id),payrollInput);
  forgedBatch.set(doc(finance,'payslips',id),{...payslipInput,staffId:'other-employee'});
  await assertFails(forgedBatch.commit());
  await assertFails(setDoc(doc(finance,'payroll',id),payrollInput));
  await assertFails(setDoc(doc(finance,'payslips',id),payslipInput));
  const batch = writeBatch(finance);
  batch.set(doc(finance,'payroll',id),payrollInput);
  batch.set(doc(finance,'payslips',id),payslipInput);
  await assertSucceeds(batch.commit());
  await assertFails(setDoc(doc(finance,'payroll',id),payrollInput));
  await assertFails(updateDoc(doc(finance,'payroll',id),{netSalary:1}));
  await assertFails(updateDoc(doc(finance,'payslips',id),{netPayable:1}));
  await assertFails(setDoc(doc(outsider,'payroll','tenant-b_employee_2026-10'),{...payrollInput,tenantId:'tenant-b',payrollId:'tenant-b_employee_2026-10'}));
  console.log('Atomic payroll + payslip creates allowed together, single writes and mutation denied');
  console.log('Phase 5 HR privacy, approvals and forbidden payroll writes: PASS');
} finally {
  await env.cleanup();
}
