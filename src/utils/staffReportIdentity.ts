import { isStaffAlias, type IdentityStaff } from './staffIdentityAudit';
/** Exact identifiers and explicit aliases only. Never infer a person from a name. */
export function canonicalStaff(record: IdentityStaff, staff: IdentityStaff[], visited=new Set<string>()): IdentityStaff | undefined {
 if(visited.has(record.id))return;visited.add(record.id);
 const target=record.duplicate_of || record.canonical_staff_id;
 if(!target)return isStaffAlias(record)?undefined:record;
 const next=staff.find(s=>s.id===target&&s.tenantId===record.tenantId);
 return next?canonicalStaff(next,staff,visited):undefined;
}
export function staffReportIdentity(id: string | undefined, staff: IdentityStaff[], tenantId: string): string {
 if(!id)return 'Not recorded';
 const scoped=staff.filter(s=>s.tenantId===tenantId);
 const direct=scoped.filter(s=>s.id===id);
 const candidates=(direct.length?direct:scoped.filter(s=>s.uid===id)).map(s=>canonicalStaff(s,scoped));
 if(!candidates.length)return 'Staff record unavailable';
 if(candidates.some(s=>!s))return 'Staff identity needs review';
 const unique=Array.from(new Map(candidates.map(s=>[s!.id,s!])).values());
 if(unique.length!==1)return 'Staff identity needs review';
 const s=unique[0];const name=s.full_name||s.fullName||s.displayName||'Staff name unavailable';
 return s.staff_code?`${name} (${s.staff_code})`:name;
}
