/** Read adapter for existing HR reports and payslips. Monetary authority stays
 * in the finalized Level 11 line; legacy payroll records pass through unchanged. */
export function payrollRecordView<T extends Record<string, any>>(record:T):T {
  if(record.payrollVersion!==11 || !record.line)return record;
  const line=record.line;
  return {...record,staff_name:line.staffName,employee_id:line.employeeId,
    year:Number(String(record.month).slice(0,4)),base_salary:line.baseSalary,
    gross_salary:line.baseSalary+line.bonuses,allowances:line.bonuses,
    bonus_notes:line.bonusNotes,allowancesNotes:line.bonusNotes,unpaidLeaveDeduction:0,
    deductions:line.deductions,advance_deduction:line.advanceDeduction,fine_deduction:line.fineDeduction,
    nssf_employee:line.nssfEmployee,nssf_employer:line.nssfEmployer,paye:line.paye,
    net_salary:line.netSalary,unpaid_leave_deduction:0,basePay:line.baseSalary,netPayable:line.netSalary,
    advanceDeduction:line.advanceDeduction,fineDeduction:line.fineDeduction,
    nssfEmployee:line.nssfEmployee,nssfEmployer:line.nssfEmployer,
    approvedLeavesDesc:line.approvedLeavesDesc||'None',rejectedLeavesDesc:line.rejectedLeavesDesc||'None',
    advancesDesc:line.advancesDesc||'None'};
}
