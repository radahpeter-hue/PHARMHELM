/**
 * Uganda resident employee PAYE and NSSF, whole-number UGX.
 * URA FY 2026/27 bands take effect 2026-07-01; historical periods use
 * FY 2025/26 bands. PAYE is assessed before deducting employee NSSF.
 *
 * Sources (retrieved 2026-10-21):
 * https://ura.go.ug/en/changes-to-paye-return-form-following-the-income-tax-amendment-act-2026/
 * https://ura.go.ug/en/ask-ura-commissioner-general-12/
 * https://www.nssfug.org/about-us/membership/
 *
 * This policy is for resident employees, not consultant withholding or
 * part-time secondary employment. Financial posting remains independently gated.
 */
export const RESIDENT_PAYE_NEW_EFFECTIVE = '2026-07-01';

function safeUGX(amount: number): number {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Gross pay must be non-negative whole-number UGX');
  return amount;
}
export function calculateUgandaResidentPaye(monthlyGrossUGX: number, payPeriodEndISO: string): number {
  const gross = safeUGX(monthlyGrossUGX);
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(payPeriodEndISO) || Number.isNaN(Date.parse(payPeriodEndISO))) {
    throw new Error('Valid payroll period end date is required');
  }
  let tax: number;
  if (payPeriodEndISO >= RESIDENT_PAYE_NEW_EFFECTIVE) {
    if (gross <= 335000) tax = 0;
    else if (gross <= 410000) tax = (gross - 335000) * 0.20;
    else if (gross <= 485000) tax = 15000 + (gross - 410000) * 0.25;
    else tax = 33750 + (gross - 485000) * 0.30 + Math.max(0, gross - 10000000) * 0.10;
  } else {
    if (gross <= 235000) tax = 0;
    else if (gross <= 335000) tax = (gross - 235000) * 0.10;
    else if (gross <= 410000) tax = 10000 + (gross - 335000) * 0.20;
    else tax = 25000 + (gross - 410000) * 0.30 + Math.max(0, gross - 10000000) * 0.10;
  }
  const result = Math.round(tax);
  if (!Number.isSafeInteger(result)) throw new Error('Unsafe PAYE');
  return result;
}
export function calculateUgandaNssf(monthlyGrossUGX: number, eligible: boolean): { employee: number; employer: number } {
  const gross = safeUGX(monthlyGrossUGX);
  if (!eligible) return { employee: 0, employer: 0 };
  const employee = Math.round(gross * 0.05);
  const employer = Math.round(gross * 0.10);
  if (!Number.isSafeInteger(employee) || !Number.isSafeInteger(employer)) throw new Error('Unsafe NSSF');
  return { employee, employer };
}
