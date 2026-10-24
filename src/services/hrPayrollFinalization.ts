import { doc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';
import { validatePayrollDraft } from './hrPayrollPolicy';
import { payrollSnapshot } from './hrPayrollApproval';
import {validPayrollTaxAttestationReason} from './hrPayrollTaxReview';

export interface FinalPayrollInput {
  staffId: string; staffName: string; branchId: string; period: string;
  baseSalary: number; bonuses: number; deductions: number; netSalary: number;
  paye: number; nssfEmployee: number; nssfEmployer: number;
  advanceDeduction: number; fineDeduction: number; unpaidLeaveDeduction: number;
  advanceId?: string;
  dueDate?: string;
  taxReviewNote?: string;
  reviewed: boolean;
}
/** Finalization records a payable, NOT an account movement or evidence of salary payment. */
export async function finalizePayrollDraft(
  input: { tenantId: string; actorUid: string; records: readonly FinalPayrollInput[] },
  connection: Firestore = db
): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(input.tenantId) || !input.actorUid
      || input.records.length === 0 || input.records.length > 100) throw new Error('Invalid payroll scope or empty period');
  const ids = new Set<string>();
  const approvals = new Map<string, any>();
  for (const record of input.records) {
    if (!/^[A-Za-z0-9_-]{1,150}$/.test(record.staffId)
        || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(record.period) || !record.reviewed
        || !record.branchId || !record.staffName.trim()) throw new Error('Payroll requires reviewed staff, branch and month');
    const key = `${input.tenantId}_${record.staffId}_${record.period}`;
    if (ids.has(key)) throw new Error('Duplicate staff and month in payroll draft');
    ids.add(key);
    const issue = validatePayrollDraft(record);
    if (issue) throw new Error(issue);
    const components = [record.paye,record.nssfEmployee,record.nssfEmployer,record.advanceDeduction,record.fineDeduction,record.unpaidLeaveDeduction];
    if (components.some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('Invalid deduction component');
    if (record.paye + record.nssfEmployee + record.advanceDeduction + record.fineDeduction + record.unpaidLeaveDeduction > record.deductions) throw new Error('Payroll deductions understate components');
  }
  const rows = input.records.map(record => {
    const id = `${input.tenantId}_${record.staffId}_${record.period}`;
    return { record, id, payroll: doc(connection,'payroll',id), payslip: doc(connection,'payslips',id) };
  });
  // One atomic employee accrual per transaction keeps Security Rules document-access
  // budgets bounded for large payroll runs. A failed employee never leaves a partial payslip.
  for (const row of rows) await runTransaction(connection, async tx => {
    let advancePosition: any;
    {
      const [payroll,payslip,approval,position] = await Promise.all([tx.get(row.payroll),tx.get(row.payslip),tx.get(doc(connection,'payroll_approvals',row.id)),tx.get(doc(row.payroll,'state','current'))]);
      const expected = payrollSnapshot(row.record);
      if (!approval.exists() || approval.data().status !== 'approved' || !validPayrollTaxAttestationReason(approval.data().reason) || approval.data().approvedBy === input.actorUid
          || Object.entries(expected).some(([key,value]) => approval.data().snapshot[key] !== value))
        throw new Error('Matching independent HR approval is required.');
      approvals.set(row.id, approval.data());
      if (payroll.exists() || payslip.exists() || position.exists()) {
        if (payroll.exists() && payslip.exists() && position.exists() && !position.data().voided
            && payroll.data().tenantId === input.tenantId && payroll.data().finalizedBy === input.actorUid
            && payroll.data().approvalRevision === approval.data().revision
            && Object.entries(expected).every(([key,value]) => payroll.data().snapshot?.[key] === value && payslip.data().snapshot?.[key] === value))
          return; // Exact retry resumes a large run without recognizing any obligation twice.
        throw new Error('Payroll already finalized, reversed or requires reconciliation');
      }
      if(row.record.advanceDeduction > 0) {
        const advance = await tx.get(doc(connection,'advance_requests',row.record.advanceId!,'state','current'));
        if(!advance.exists() || advance.data().tenantId !== input.tenantId || advance.data().staffId !== row.record.staffId
          || advance.data().outstandingUGX < row.record.advanceDeduction) throw new Error('Verified advance balance is insufficient.');
        advancePosition = advance.data();
      }
    }
    {
      const {record,id,payroll,payslip} = row;
      const common = {
        tenantId: input.tenantId, staffId: record.staffId, period: record.period,
        payrollId: id, finalizedBy: input.actorUid, finalizedAt: serverTimestamp(),
        netSalary: record.netSalary, baseSalary: record.baseSalary, bonuses: record.bonuses,
        deductions: record.deductions, paye: record.paye, nssfEmployee: record.nssfEmployee,
        nssfEmployer: record.nssfEmployer, advanceDeduction: record.advanceDeduction,
        fineDeduction: record.fineDeduction, unpaidLeaveDeduction: record.unpaidLeaveDeduction,
        approvalRevision: approvals.get(id).revision, hrApprovedBy: approvals.get(id).approvedBy,
        snapshot: payrollSnapshot(record),
        salaryExpenseUGX: record.baseSalary + record.bonuses - record.unpaidLeaveDeduction,
        employerNssfExpenseUGX: record.nssfEmployer,
        payePayableUGX: record.paye, nssfPayableUGX: record.nssfEmployee + record.nssfEmployer,
        otherDeductionsPayableUGX: record.deductions - record.paye - record.nssfEmployee - record.unpaidLeaveDeduction - record.advanceDeduction,
        advanceId: record.advanceId || '', advanceRecoveryUGX: record.advanceDeduction,
        dueDate:record.dueDate || null,
        netSalaryPayableUGX: record.netSalary, accountingReference: id,
        status: 'approved_unpaid'
      };
      tx.set(doc(payroll,'state','current'), {tenantId:input.tenantId,snapshot:common.snapshot,
        outstandingUGX:record.netSalary,paidUGX:0,voided:false,lastAction:'recognition',updatedAt:serverTimestamp()});
      tx.set(payroll, {...common, staff_name: record.staffName, branch_id: record.branchId,
        month: record.period, base_salary: record.baseSalary, net_salary: record.netSalary,
        nssf_employee: record.nssfEmployee, nssf_employer: record.nssfEmployer,
        advance_deduction: record.advanceDeduction, fine_deduction: record.fineDeduction});
      tx.set(payslip, {...common, staff_name: record.staffName, branch_id: record.branchId,
        month: record.period, year: Number(record.period.slice(0,4)),
        netPayable: record.netSalary, basePay: record.baseSalary, allowances: record.bonuses});
      if(advancePosition) {
        const root=doc(connection,'advance_requests',record.advanceId!);
        tx.set(doc(root,'recoveries',id),{tenantId:input.tenantId,branchId:record.branchId,staffId:record.staffId,payrollId:id,
          deltaUGX:record.advanceDeduction,actorUid:input.actorUid,createdAt:serverTimestamp()});
        tx.update(doc(root,'state','current'),{outstandingUGX:advancePosition.outstandingUGX-record.advanceDeduction,
          recoveredUGX:advancePosition.recoveredUGX+record.advanceDeduction,lastAction:id,updatedAt:serverTimestamp()});
      }
    }
  });
}
