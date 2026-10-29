import { doc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';
import { hasAnyRole } from '../utils/roles';
import { isBusinessDate } from '../utils/eodBusinessDate';
import type { EodShift } from '../utils/eodShifts';
export type LegacyShiftEvidence = {id?:string;tenantId:string; branch_id:string; sale_id:string; sale_timestamp:string; businessDate:string; shift_id:string; shift_name:string; startTime:string; endTime:string; verified_by:string; reason:string};
export async function verifyLegacyEodShift(saleIds:string[], branchId:string, date:string, shift:EodShift,
  reason:string, profile:{uid:string;tenantId:string;role?:string;secondaryRoles?:string[]}, connection:Firestore=db) {
  if(!hasAnyRole(profile,['IT Head']) || !reason.trim() || !isBusinessDate(date) || !saleIds.length || saleIds.length>10) throw new Error('IT Head, a valid business date, selected receipts and verification reason are required.');
  const ids=[...new Set(saleIds)];
  await runTransaction(connection,async tx=>{
    const rows=[];
    for(const id of ids){
      if(/[~/]/.test(id)||/[~/]/.test(profile.tenantId))throw new Error('Invalid receipt identity.');
      const sale=await tx.get(doc(connection,'sales',id));
      const ref=doc(connection,'audit_logs','eod_verify_'+profile.tenantId+'~'+id);
      const existing=await tx.get(ref);
      if(!sale.exists()||sale.data().tenantId!==profile.tenantId||sale.data().branchId!==branchId||sale.data().eodShift)throw new Error('Receipt is unavailable or already has checkout shift evidence.');
      if(existing.exists()){
        if(existing.data().shift_id!==shift.id||existing.data().businessDate!==date)throw new Error('Receipt is already verified for another shift/date.');
        continue;
      }
      rows.push({ref,data:{tenantId:profile.tenantId,branch_id:branchId,sale_id:id,sale_timestamp:sale.data().timestamp,
        businessDate:date,shift_id:shift.id,shift_name:shift.name,startTime:shift.startTime,endTime:shift.endTime,
        verified_by:profile.uid,verified_at:serverTimestamp(),reason:reason.trim(),source:'IT_HEAD_VERIFIED_LEGACY'}});
    }
    for(const row of rows)tx.set(row.ref,row.data);
  });
}
