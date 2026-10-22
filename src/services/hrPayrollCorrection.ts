import { doc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';

/** Void only a completely unpaid accrual. Original records and HR signatures remain immutable. */
export async function requestPayrollVoid(input: {payrollId: string; actorUid: string; reason: string}, connection: Firestore = db) {
  if (input.reason.trim().length < 5) throw new Error('Record a payroll correction reason.');
  await runTransaction(connection, async tx => {
    const payroll = await tx.get(doc(connection,'payroll',input.payrollId));
    if (!payroll.exists()) throw new Error('Payroll not found.');
    tx.set(doc(connection,'payroll',input.payrollId,'corrections','void_request'), {
      tenantId: payroll.data().tenantId, snapshot: payroll.data().snapshot,
      approvedBy: input.actorUid, approvedAt: serverTimestamp(), reason: input.reason.trim()
    });
  });
}
export async function voidUnpaidPayroll(input: {payrollId: string; actorUid: string}, connection: Firestore = db) {
  await runTransaction(connection, async tx => {
    const root = doc(connection,'payroll',input.payrollId);
    const state = doc(root,'state','current');
    const request = doc(root,'corrections','void_request');
    const reversal = doc(root,'corrections','void');
    const [payroll,position,approval,existing] = await Promise.all([tx.get(root),tx.get(state),tx.get(request),tx.get(reversal)]);
    if (!payroll.exists() || !position.exists() || !approval.exists() || existing.exists()
        || position.data().paidUGX !== 0 || position.data().voided || approval.data().approvedBy === input.actorUid)
      throw new Error('Independent HR approval and a wholly unpaid obligation are required.');
    const p = payroll.data();
    tx.set(reversal, {tenantId:p.tenantId, snapshot:p.snapshot, reversesPayrollId:input.payrollId,
      postedBy:input.actorUid, postedAt:serverTimestamp(), reason:approval.data().reason,
      salaryExpenseUGX:-p.salaryExpenseUGX, employerNssfExpenseUGX:-p.employerNssfExpenseUGX,
      payePayableUGX:-p.payePayableUGX,nssfPayableUGX:-p.nssfPayableUGX,
      otherDeductionsPayableUGX:-p.otherDeductionsPayableUGX,netSalaryPayableUGX:-p.netSalaryPayableUGX});
    tx.update(state,{outstandingUGX:0,voided:true,lastAction:'void',updatedAt:serverTimestamp()});
  });
}
