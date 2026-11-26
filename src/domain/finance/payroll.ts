export const PAYROLL_BATCHES = 'finance_payroll_batches_v1';
export const PAYROLL_LINES = 'finance_payroll_lines_v1';
export const PAYROLL_EVENTS = 'finance_payroll_events_v1';
export const PAYROLL_STATUS = 'finance_payroll_status_v1';
export const PAYROLL_PAYMENTS = 'finance_payroll_payments_v1';
export type PayrollStatus = 'draft' | 'pending_finance' | 'returned' | 'approved' | 'partial' | 'paid';
export const payrollStatusLabels: Record<PayrollStatus, string> = {
  draft: 'Draft', pending_finance: 'Pending Finance Approval', returned: 'Returned for Correction',
  approved: 'Approved, Awaiting Payment', partial: 'Partially Paid', paid: 'Paid',
};
export interface PayrollLine {
  staffId: string; staffName: string; employeeId: string; branchId: string;
  loggedHours: number; paidLeaveHours: number; baseSalary: number; bonuses: number;
  bonusNotes: string; advanceDeduction: number; fineDeduction: number;
  nssfEmployee: number; nssfEmployer: number; paye: number; customDeduction: number;
  deductions: number; netSalary: number; reviewed: boolean;
  [key: string]: unknown;
}
export interface PayrollTotals {
  net: number; gross: number; employerNssf: number; employeeNssf: number; paye: number; otherDeductions: number;
}
export const emptyPayrollTotals = (): PayrollTotals => ({net: 0, gross: 0, employerNssf: 0, employeeNssf: 0, paye: 0, otherDeductions: 0});
/** Nonnegative monetary components round half up once; net is their integer difference. */
export function roundPayrollUGX(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw new Error('Payroll amounts must be finite nonnegative UGX.');
  const result = Math.round(value);
  if (!Number.isSafeInteger(result)) throw new Error('Payroll amount exceeds the whole UGX limit.');
  return result;
}
export function finalizePayrollLine<T extends PayrollLine>(raw: T): T {
  if (!raw.staffId || raw.staffId.includes('/') || !raw.staffName || !raw.branchId || !raw.reviewed) throw new Error('Review every employee before submission.');
  if (![raw.loggedHours, raw.paidLeaveHours].every(x => Number.isFinite(x) && x >= 0)) throw new Error('Invalid payable hours.');
  const line = {...raw,roundingConvention:'UGX components: nonnegative half up; net is integer earnings minus integer deductions'};
  for (const key of ['baseSalary','bonuses','advanceDeduction','fineDeduction','nssfEmployee','nssfEmployer','paye','customDeduction'] as const) {
    (line as PayrollLine)[key] = roundPayrollUGX(raw[key]);
  }
  if (line.bonuses > 0 && !line.bonusNotes.trim()) throw new Error('An allowance or bonus requires an HR reason.');
  line.deductions = line.advanceDeduction + line.fineDeduction + line.nssfEmployee + line.paye + line.customDeduction;
  line.netSalary = line.baseSalary + line.bonuses - line.deductions;
  if (!Number.isSafeInteger(line.netSalary) || line.netSalary < 0) throw new Error(`${line.staffName}: deductions exceed earnings. Review or defer deductions.`);
  return line;
}
export function addPayrollTotals(totals: PayrollTotals, line: PayrollLine): PayrollTotals {
  const next = {net: totals.net + line.netSalary, gross: totals.gross + line.baseSalary + line.bonuses,
    employerNssf: totals.employerNssf + line.nssfEmployer, employeeNssf: totals.employeeNssf + line.nssfEmployee,
    paye: totals.paye + line.paye, otherDeductions: totals.otherDeductions + line.advanceDeduction + line.fineDeduction + line.customDeduction};
  if (!Object.values(next).every(x => Number.isSafeInteger(x) && x >= 0)) throw new Error('Payroll total exceeds the whole UGX limit.');
  return next;
}
export function reconcilePayroll(lines: PayrollLine[]) {
  if (!lines.length || new Set(lines.map(x => x.staffId)).size !== lines.length) throw new Error('Payroll must contain unique employees.');
  return lines.reduce(addPayrollTotals, emptyPayrollTotals());
}
export function employeePayrollStatus(batchStatus: PayrollStatus, paid: number, net: number): PayrollStatus {
  if (!['approved','partial','paid'].includes(batchStatus)) return batchStatus;
  return net > 0 && paid >= net ? 'paid' : paid > 0 ? 'partial' : 'approved';
}
export function salaryPaymentBalance(net: number, paid: number, amount: number) {
  if (![net,paid,amount].every(Number.isSafeInteger) || paid < 0 || net < paid || amount <= 0 || amount > net - paid) throw new Error('Payment exceeds the outstanding whole UGX salary.');
  return {paid: paid + amount, outstanding: net - paid - amount};
}
export async function payrollDigest(value: unknown) {
  const canonical=(item:any):any=>Array.isArray(item)?item.map(canonical):item&&typeof item==='object'?Object.fromEntries(Object.keys(item).sort().filter(key=>item[key]!==undefined).map(key=>[key,canonical(item[key])])):item;
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(value))));
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
}
/** One permanent, tenant-scoped obligation for the exact selected payroll period. */
export async function payrollIdentity(tenantId: string, start: string, end: string, legacySourceId?:string) {
  if (!tenantId || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) throw new Error('Select a valid payroll period.');
  if(legacySourceId&&(legacySourceId.includes('/')||legacySourceId.length>500))throw Error('Invalid legacy payroll reference.');
  const hash = await payrollDigest(legacySourceId?[tenantId,start,end,legacySourceId]:[tenantId,start,end]);
  return {id: legacySourceId?tenantId+'_REC_'+legacySourceId:tenantId + '_PAY_' + start + '_' + end, reference: 'PAY-' + end.slice(0,7).replace('-','') + '-' + hash.slice(0,10).toUpperCase()};
}
