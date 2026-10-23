import {calculateUgandaNssf,calculateUgandaResidentPaye} from './ugandaPayrollTaxPolicy';

export function validPayrollTaxAttestationReason(reason:string) {
  return /^(Resident primary employment verified\.|Documented manual statutory assessment\.).{10,}$/.test(reason);
}

/** Employment duration alone establishes neither tax residence nor primary employment. */
export function reviewedPayrollTaxes(input:{treatment:string;grossUGX:number;periodEnd:string;nssfEligible:boolean;reason:string;paye:number;employee:number;employer:number}) {
  if(!['resident_primary','documented_manual'].includes(input.treatment))throw new Error('Select verified resident-primary treatment or documented Finance/HR assessment.');
  if(input.reason.trim().length<10)throw new Error('Document tax residence, employment basis and statutory assessment before approval.');
  if(input.treatment==='resident_primary') {
    const nssf=calculateUgandaNssf(input.grossUGX,input.nssfEligible);
    return {paye:calculateUgandaResidentPaye(input.grossUGX,input.periodEnd),employee:nssf.employee,employer:nssf.employer,
      note:`Resident primary employment verified. ${input.reason.trim()}`};
  }
  if([input.grossUGX,input.paye,input.employee,input.employer].some(v=>!Number.isSafeInteger(v)||v<0))throw new Error('Reviewed statutory amounts must be non-negative whole-number UGX.');
  return {paye:input.paye,employee:input.employee,employer:input.employer,note:`Documented manual statutory assessment. ${input.reason.trim()}`};
}
