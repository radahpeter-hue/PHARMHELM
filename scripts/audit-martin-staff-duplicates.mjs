import {createRequire} from 'node:module';
import {planStaffDuplicateAudit,identityEmails} from '../src/utils/staffIdentityAudit.ts';
const require=createRequire('/tmp/staff-backfill-runtime/package.json');
const {initializeApp,applicationDefault,deleteApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');const {getAuth}=require('firebase-admin/auth');
const app=initializeApp({credential:applicationDefault(),projectId:'gen-lang-client-0911422817'},'staff-duplicate-audit');
const tenantId='zehqTDcKyrDAOHKK3stJ';
try {
 const db=getFirestore(app,'ai-studio-f7d8654b-e089-425a-a506-38159afe1e75');
 if((await db.collection('tenants').doc(tenantId).get()).data()?.slug!=='mp')throw Error('Unexpected tenant');
 const snap=await db.collection('staff').where('tenantId','==',tenantId).get();
 const staff=snap.docs.map(d=>({...d.data(),id:d.id}));
 const identifiers=new Map();
 for(const s of staff){for(const uid of [s.id,s.uid,s.legacyStaffId].filter(v=>typeof v==='string'&&v.length&&v.length<=128))identifiers.set('uid:'+uid,{uid});for(const email of identityEmails(s))identifiers.set('email:'+email,{email});}
 const auth=new Map(),list=Array.from(identifiers.values());
 for(let i=0;i<list.length;i+=100){const result=await getAuth(app).getUsers(list.slice(i,i+100));for(const u of result.users)auth.set(u.uid,{uid:u.uid,email:u.email,disabled:u.disabled,tenantId:u.customClaims?.tenantId});}
 const plan=planStaffDuplicateAudit(staff,Array.from(auth.values()));
 console.log(JSON.stringify({mode:'READ_ONLY_STAFF_DUPLICATE_AUDIT',...plan.summary,groups:plan.groups.map((g,i)=>({group:i+1,decision:g.decision,...g.evidence})),duplicatesWithWelfareUsage:staff.filter(s=>plan.groups.some(g=>g.duplicateIds.includes(s.id))&&(Number(s.welfare_spent||0)>0||Number(s.welfare_used_ytd||0)>0)).length,writes:0}));
}finally{await deleteApp(app);}
