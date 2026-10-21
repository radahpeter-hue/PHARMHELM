import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

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
  await assertSucceeds(getDoc(doc(hr, 'advance_requests', 'advance-test')));
  console.log('Phase 5 advance authorization and forbidden payroll writes: PASS');
} finally {
  await env.cleanup();
}
