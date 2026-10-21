export function validatePayrollDraft(record: {baseSalary: number; bonuses: number; deductions: number; netSalary: number}): string | null {
  for (const [name, amount] of Object.entries(record)) {
    if (!Number.isSafeInteger(amount) || amount < 0) return `Invalid whole-number UGX ${name}`;
  }
  if (!Number.isSafeInteger(record.baseSalary + record.bonuses)) return 'Unsafe payroll gross amount';
  if (record.baseSalary + record.bonuses - record.deductions !== record.netSalary) return 'Payroll does not reconcile';
  return null;
}
