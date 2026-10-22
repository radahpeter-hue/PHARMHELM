import { doc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';
import { validatePayrollDraft } from './hrPayrollPolicy';

export interface FinalPayrollInput {
  staffId: string; staffName: string; branchId: string; period: string;
  baseSalary: number; bonuses: number; deductions: number; netSalary: number;
  paye: number; nssfEmployee: number; nssfEmployer: number;
  advanceDeduction: number; fineDeduction: number; unpaidLeaveDeduction: number;
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
  await runTransaction(connection, async tx => {
    // Reads before writes; one transaction must include every employee and paired payslip.
    for (const row of rows) {
      const [payroll,payslip] = await Promise.all([tx.get(row.payroll),tx.get(row.payslip)]);
      if (payroll.exists() || payslip.exists()) throw new Error('Payroll already finalized or requires reconciliation');
    }
    for (const {record,id,payroll,payslip} of rows) {
      const common = {
        tenantId: input.tenantId, staffId: record.staffId, period: record.period,
        payrollId: id, finalizedBy: input.actorUid, finalizedAt: serverTimestamp(),
        netSalary: record.netSalary, baseSalary: record.baseSalary, bonuses: record.bonuses,
        deductions: record.deductions, paye: record.paye, nssfEmployee: record.nssfEmployee,
        nssfEmployer: record.nssfEmployer, advanceDeduction: record.advanceDeduction,
        fineDeduction: record.fineDeduction, unpaidLeaveDeduction: record.unpaidLeaveDeduction,
        status: 'approved_unpaid'
      };
      tx.set(payroll, {...common, staff_name: record.staffName, branch_id: record.branchId,
        month: record.period, base_salary: record.baseSalary, net_salary: record.netSalary,
        nssf_employee: record.nssfEmployee, nssf_employer: record.nssfEmployer,
        advance_deduction: record.advanceDeduction, fine_deduction: record.fineDeduction});
      tx.set(payslip, {...common, staff_name: record.staffName, branch_id: record.branchId,
        month: record.period, year: Number(record.period.slice(0,4)),
        netPayable: record.netSalary, basePay: record.baseSalary, allowances: record.bonuses});
    }
  });
}
