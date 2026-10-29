import { collection, getDocs, query, where, doc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';
import { hasAnyRole } from '../utils/roles';
import { isBusinessDate } from '../utils/eodBusinessDate';
import type { EodShift } from '../utils/eodShifts';
export type LegacyShiftEvidence = {id?:string;tenantId:string; branch_id:string; sale_id:string; sale_timestamp:string; businessDate:string; shift_id:string; shift_name:string; startTime:string; endTime:string; userId:string; reason:string};
export async function verifyLegacyEodShift(saleIds:string[], branchId:string, date:string, shift:EodShift,
  reason:string, profile:{uid:string;tenantId:string;role?:string;secondaryRoles?:string[]}, connection:Firestore=db) {
  if(!hasAnyRole(profile,['IT Head']) || !reason.trim() || !isBusinessDate(date) || !saleIds.length || saleIds.length>10) throw new Error('IT Head, a valid business date, selected receipts and verification reason are required.');
  const ids=[...new Set(saleIds)];
  const loadEvidence=async()=>{
    const snap=await getDocs(query(collection(connection,'audit_logs'),where('tenantId','==',profile.tenantId)));
    return new Map(snap.docs.map(d=>[d.id,d.data()]));
  };
  const evidence=await loadEvidence();
  try { await runTransaction(connection,async tx=>{
    const rows=[];
    for(const id of ids){
      if(/[~/]/.test(id)||/[~/]/.test(profile.tenantId))throw new Error('Invalid receipt identity.');
      const sale=await tx.get(doc(connection,'sales',id));
      const ref=doc(connection,'audit_logs','e_'+profile.tenantId+'~'+id);
      const existing=evidence.get(ref.id);
      if(!sale.exists()||sale.data().tenantId!==profile.tenantId||sale.data().branchId!==branchId||sale.data().eodShift)throw new Error('Receipt is unavailable or already has checkout shift evidence.');
      if(existing){
        if(existing.shift_id!==shift.id||existing.businessDate!==date)throw new Error('Receipt is already verified for another shift/date.');
        continue;
      }
      rows.push({ref,data:{tenantId:profile.tenantId,branch_id:branchId,sale_id:id,sale_timestamp:sale.data().timestamp,
        businessDate:date,shift_id:shift.id,shift_name:shift.name,startTime:shift.startTime,endTime:shift.endTime,
        userId:profile.uid,timestamp:serverTimestamp(),reason:reason.trim(),source:'IT_HEAD_VERIFIED_LEGACY'}});
    }
    for(const row of rows)tx.set(row.ref,row.data);
  }); } catch(error) {
    const latest=await loadEvidence();
    if(ids.every(id=>{const row=latest.get('e_'+profile.tenantId+'~'+id);return row?.shift_id===shift.id&&row?.businessDate===date&&row?.branch_id===branchId;}))return;
    throw error;
  }
}
