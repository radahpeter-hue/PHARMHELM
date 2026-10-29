import type { Sale } from '../types';
import type { LegacyShiftEvidence } from '../services/eodLegacyShiftService';
/** A projection for reconciliation only: source sale/payment documents are never rewritten. */
export function withVerifiedLegacyShifts(sales:Sale[], evidence:LegacyShiftEvidence[]):Sale[]{
  return sales.map(sale=>{
    if(sale.eodShift)return sale;
    const e=evidence.find(e=>e.id==='eod_verify_'+sale.tenantId+'~'+sale.id&&e.tenantId===sale.tenantId&&e.branch_id===sale.branchId&&e.sale_id===sale.id&&e.sale_timestamp===sale.timestamp);
    return e?{...sale,eodShift:{version:1,timeZone:'Africa/Kampala',businessDate:e.businessDate,shiftId:e.shift_id,shiftName:e.shift_name,startTime:e.startTime,endTime:e.endTime}}:sale;
  });
}
