export type IdentityStaff = {id: string; tenantId: string; [key: string]: any};
export type IdentityAuth = {uid: string; email?: string; disabled?: boolean; tenantId?: string};
export const identityText=(v: unknown)=>typeof v==='string'?v.trim().toLowerCase().replace(/\s+/g,' '):'';
export const identityName=(s: IdentityStaff)=>identityText(s.full_name || s.fullName || s.displayName);
export function identityPhone(s: IdentityStaff): string {
 let p=String(s.phone_number || s.phone || '').replace(/\D/g,'');
 if(/^0[37]\d{8}$/.test(p))p='256'+p.slice(1);
 if(/^[37]\d{8}$/.test(p))p='256'+p;
 return p.length>=9 && !/^(\d)\1+$/.test(p)?p:'';
}
export const identityEmails=(s: IdentityStaff)=>Array.from(new Set([s.authEmail,s.email,s.contactEmail].map(identityText).filter(v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))));
export function isStaffAlias(s: any): boolean {return !!(s.duplicate_of || s.canonical_staff_id || s.is_duplicate);}
export function planStaffDuplicateAudit(staff: IdentityStaff[], auth: IdentityAuth[]) {
 const records=staff.filter(s=>!isStaffAlias(s));
 const parents=records.map((_,i)=>i);const root=(i:number):number=>parents[i]===i?i:(parents[i]=root(parents[i]));
 const evidence=(a:IdentityStaff,b:IdentityStaff)=>{
  const uid=!!a.uid && a.uid===b.uid;
  const link=a.legacyStaffId===b.id || b.legacyStaffId===a.id;
  const name=!!identityName(a) && identityName(a)===identityName(b);
  const email=identityEmails(a).some(e=>identityEmails(b).includes(e));
  const phone=!!identityPhone(a) && identityPhone(a)===identityPhone(b);
  return {uid,link,name,email,phone};
 };
 for(let i=0;i<records.length;i++)for(let j=0;j<i;j++){
  const e=evidence(records[i],records[j]);if(e.uid||e.link||(e.name&&(e.email||e.phone)))parents[root(i)]=root(j);
 }
 const groups=new Map<number,IdentityStaff[]>();records.forEach((r,i)=>groups.set(root(i),[...(groups.get(root(i))||[]),r]));
 const results=Array.from(groups.values()).filter(g=>g.length>1).map(group=>{
  const enabled=group.filter(s=>auth.some(a=>a.uid===s.id&&!a.disabled&&(!a.tenantId||a.tenantId===s.tenantId)));
  const canonical=enabled.length===1?enabled[0]:undefined;
  const pairs=canonical?group.filter(s=>s.id!==canonical.id).map(s=>({record:s,...evidence(s,canonical)})):[];
  const verified=!!canonical && pairs.every(p=>p.uid||p.link||(p.name&&p.email&&p.phone)
    ||(p.name&&identityText(p.record.authEmail)!==''&&identityText(p.record.authEmail)===identityText(canonical.authEmail)
      &&auth.some(a=>a.uid===canonical.id&&identityText(a.email)===identityText(canonical.authEmail))));
  const allNamed=Array.from(new Set(group.map(identityName).filter(Boolean))).length;
  return {records:group.map(s=>s.id),canonicalId:verified?canonical!.id:null,duplicateIds:verified?pairs.map(p=>p.record.id):[],
    decision:verified?'verified_duplicate':'review_required',evidence:{size:group.length,enabledUidDocuments:enabled.length,
      distinctNames:allNamed,sameUid:pairs.some(p=>p.uid),explicitLink:pairs.some(p=>p.link),sameEmail:pairs.every(p=>p.email),samePhone:pairs.every(p=>p.phone)}};
 });
 return {groups:results,summary:{records:staff.length,aliases:staff.length-records.length,duplicateGroups:results.length,
   verifiedGroups:results.filter(g=>g.canonicalId).length,verifiedDuplicates:results.reduce((n,g)=>n+g.duplicateIds.length,0),reviewGroups:results.filter(g=>!g.canonicalId).length}};
}
