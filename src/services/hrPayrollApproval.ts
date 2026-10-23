import { doc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';
import { validatePayrollDraft } from './hrPayrollPolicy';
import type { FinalPayrollInput } from './hrPayrollFinalization';

export function payrollSnapshot(record: FinalPayrollInput) {
  const value = {
    staffId: record.staffId, staffName: record.staffName, branchId: record.branchId, period: record.period,
    baseSalary: record.baseSalary, bonuses: record.bonuses, deductions: record.deductions,
    netSalary: record.netSalary, paye: record.paye, nssfEmployee: record.nssfEmployee,
    nssfEmployer: record.nssfEmployer, advanceDeduction: record.advanceDeduction,
    fineDeduction: record.fineDeduction, unpaidLeaveDeduction: record.unpaidLeaveDeduction,
    ...(record.advanceDeduction > 0 ? {advanceId: record.advanceId} : {}),
    ...(record.dueDate ? {dueDate:record.dueDate} : {}),
    otherDeductions: record.deductions - record.paye - record.nssfEmployee - record.advanceDeduction
      - record.fineDeduction - record.unpaidLeaveDeduction
  };
  const issue = validatePayrollDraft(value);
  if (issue) throw new Error(issue);
  if (Object.entries(value).some(([key, amount]) => typeof amount === 'number' && (!Number.isSafeInteger(amount) || amount < 0)))
    throw new Error('Invalid payroll component');
  if (value.advanceDeduction > 0 && !/^[A-Za-z0-9_-]{1,150}$/.test(value.advanceId || ''))
    throw new Error('Advance recovery requires a certified disbursement and receivable posting reference.');
  if(record.dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(record.dueDate)||Number.isNaN(Date.parse(record.dueDate))||new Date(record.dueDate).toISOString().slice(0,10)!==record.dueDate))throw new Error('Valid HR-approved payment due date required.');
  return value;
}

/** A persisted HR signature covers the exact remuneration, recipient, branch and period. */
export async function attestPayroll(input: {tenantId: string; actorUid: string; records: readonly FinalPayrollInput[]; decision?: 'approved' | 'rejected' | 'superseded'; reason?: string}, connection: Firestore = db) {
  for (const record of input.records) {
    const snapshot = payrollSnapshot(record);
    const id = `${input.tenantId}_${record.staffId}_${record.period}`;
    await runTransaction(connection, async tx => {
      const ref = doc(connection, 'payroll_approvals', id);
      const [prior, finalized] = await Promise.all([tx.get(ref), tx.get(doc(connection, 'payroll', id))]);
      if (finalized.exists()) throw new Error('Finalized payroll cannot be reapproved.');
      const revision = prior.exists() ? prior.data().revision + 1 : 1;
      const approval = {tenantId: input.tenantId, snapshot, revision, status: input.decision || 'approved',
        approvedBy: input.actorUid, approvedAt: serverTimestamp(), reason: input.reason || 'HR reviewed remuneration and deductions'};
      tx.set(ref, approval);
      tx.set(doc(connection, 'payroll_approvals', id, 'revisions', String(revision)), approval);
    });
  }
}
