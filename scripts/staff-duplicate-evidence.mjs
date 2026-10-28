import {planStaffDuplicateAudit,identityEmails} from '../src/utils/staffIdentityAudit.ts';
export async function staffDuplicateEvidence(db,auth,tenantId,staffOverride) {
 const staff=staffOverride|| (await db.collection('staff').where('tenantId','==',tenantId).get()).docs.map(d=>({...d.data(),id:d.id}));
 const identifiers=new Map();
 for(const s of staff){for(const uid of [s.id,s.uid,s.legacyStaffId].filter(v=>typeof v==='string'&&v.length&&v.length<=128))identifiers.set('uid:'+uid,{uid});for(const email of identityEmails(s))identifiers.set('email:'+email,{email});}
 const users=new Map(),list=Array.from(identifiers.values());
 for(let i=0;i<list.length;i+=100){const result=await auth.getUsers(list.slice(i,i+100));for(const u of result.users)users.set(u.uid,{uid:u.uid,email:u.email,disabled:u.disabled,tenantId:u.customClaims?.tenantId});}
 return {staff,auth:Array.from(users.values()),plan:planStaffDuplicateAudit(staff,Array.from(users.values()))};
}
