/** Existing HR statutory calculation policy, shared only for verification and payroll drafts.
 * Assessment is not evidence of statutory remittance. HR retains authorized overrides. */
export function payrollStatutory(basePay:number,empType:string,taxEnabled:boolean,nssfEligible:boolean) {
  const isRegularStaff = empType === 'Full-Time' || empType === 'Part-Time';

      const hasNssf = taxEnabled && isRegularStaff && nssfEligible; // default true unless explicitly checked false
      const nssfEmployee = hasNssf ? basePay * 0.05 : 0;
      const nssfEmployer = hasNssf ? basePay * 0.10 : 0;

      // Progressive PAYE Tax (Uganda) & Withholding Taxes
      let paye = 0;
      if (taxEnabled) {
        if (isRegularStaff) {
          const taxableIncome = basePay - nssfEmployee;
          if (taxableIncome > 235000) {
            if (taxableIncome <= 335000) {
              paye = (taxableIncome - 235000) * 0.10;
            } else if (taxableIncome <= 410000) {
              paye = 10000 + (taxableIncome - 335000) * 0.20;
            } else {
              paye = 10000 + 15000 + (taxableIncome - 410000) * 0.30;
              if (taxableIncome > 10000000) {
                paye += (taxableIncome - 10000000) * 0.10;
              }
            }
          }
        } else if (empType === 'Resident Consultant') {
          paye = basePay * 0.06;
        } else if (empType === 'Non-Resident Consultant') {
          paye = basePay * 0.15;
        } else if (empType === 'Independent Contractor / Self-Employed') {
          paye = basePay * 0.06;
        }
      }

  return {nssfEmployee,nssfEmployer,paye};
}
