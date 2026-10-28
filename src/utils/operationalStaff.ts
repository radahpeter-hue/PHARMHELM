import { isStaffAlias } from './staffIdentityAudit';
import { canonicalStaff } from './staffReportIdentity';
export function operationalStaff<T extends {id?:string;uid?:string;tenantId?:string;[key:string]:any}>(records:T[]):T[] {
 const identities=records.map(s=>({...s,id:s.id||s.uid||''})) as any[];
 return identities.filter(s=>!isStaffAlias(s)).map(s=>({...s,identity_alias_ids:Array.from(new Set([
  ...(s.identity_alias_ids||[]),s.legacyStaffId,
  ...identities.filter(a=>isStaffAlias(a)&&canonicalStaff(a,identities)?.id===s.id).flatMap(a=>[a.id,a.uid,a.legacyStaffId])
 ].filter(Boolean)))})) as T[];
}
export function staffMatchesId(staff:any,id:unknown):boolean {
 return !!id && [staff.id,staff.uid,staff.legacyStaffId,...(staff.identity_alias_ids||[])].includes(id);
}
