import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc,getDoc} from 'firebase/firestore';
const env=await initializeTestEnvironment({projectId:'phase5-authority-audit',firestore:{rules:readFileSync(process.env.PHARMHELM_TEST_RULES||'firestore.rules','utf8')}});
const db=(uid,claims={})=>env.authenticatedContext(uid,{tenantId:'audit-a',...claims}).firestore();
const hr=db('hr'),it=db('it'),employee=db('employee'),owner=db('owner');
const cases=[];
const denied=async(name,action)=>{let allowed=false;try{await action();allowed=true;}catch(error){if(error.code!=='permission-denied')throw error;}cases.push({name,allowed});console.log(`${allowed?'VULNERABLE':'DENIED'} ${name}`);};
try {
 await env.withSecurityRulesDisabled(async c=>{
  for(const [uid,role] of [['hr','HR Head'],['it','IT Head'],['employee','Employee'],['owner','owner']])await setDoc(doc(c.firestore(),'staff',uid),{tenantId:'audit-a',role,branch_id:'masaka',assigned_branches:['masaka']});
  await setDoc(doc(c.firestore(),'staff','foreign'),{tenantId:'audit-b',role:'Employee'});
  for(const [id,tenantId] of [['audit-a','audit-a'],['audit-b','audit-b']])await setDoc(doc(c.firestore(),'system_settings',id),{tenantId,phase5SalarySettlementEnabled:false});
  for(const collection of ['global_audit_logs','platform_audit_logs','platform_users'])await setDoc(doc(c.firestore(),collection,'existing'),{tenantId:'audit-a',value:'original'});
 });
 await denied('employee enables salary settlement',()=>updateDoc(doc(employee,'system_settings','audit-a'),{phase5SalarySettlementEnabled:true}));
 await denied('employee creates activation settings',()=>setDoc(doc(employee,'system_settings','forged'),{tenantId:'audit-a',phase5SalarySettlementEnabled:true}));
 await denied('IT reassigns foreign settings to its tenant',()=>updateDoc(doc(it,'system_settings','audit-b'),{tenantId:'audit-a'}));
 await denied('IT creates an owner identity',()=>setDoc(doc(it,'staff','forged-owner'),{tenantId:'audit-a',role:'owner'}));
 await denied('HR creates a Finance identity',()=>setDoc(doc(hr,'staff','forged-finance'),{tenantId:'audit-a',role:'Finance Head'}));
 await denied('HR forges a legacy beneficiary identity',()=>updateDoc(doc(hr,'staff','hr'),{legacyStaffId:'owner'}));
 await denied('IT grants itself custom Finance permission',()=>setDoc(doc(it,'role_realms_of_operation','audit-a_IT_Head'),{tenantId:'audit-a',roleType:'custom',roleName:'IT Head',permissions:{finance:{accessLevel:'all'}}}));
 await denied('IT enables financial posting',()=>updateDoc(doc(it,'system_settings','audit-a'),{phase5SalarySettlementEnabled:true}));
 await denied('owner rewrites platform audit history',()=>updateDoc(doc(owner,'platform_audit_logs','existing'),{value:'rewritten'}));
 await denied('tenant owner promotes itself to platform administrator',()=>setDoc(doc(owner,'platform_users','owner'),{tenantId:'audit-a',role:'super_operator',active:true}));
 await denied('tenant owner reads another platform account',()=>getDoc(doc(owner,'platform_users','existing')));
 await denied('tenant owner creates a foreign tenant',()=>setDoc(doc(owner,'tenants','foreign-tenant'),{name:'Forged tenant',tenantId:'audit-a'}));
 // Use different HR fixtures so an allowed attack cannot contaminate later cases.
 await denied('HR adds owner secondary role',()=>updateDoc(doc(hr,'staff','hr'),{secondaryRoles:['owner']}));
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'staff','hr'),{secondaryRoles:[]}));
 await denied('HR changes its primary role to owner',()=>updateDoc(doc(hr,'staff','hr'),{role:'owner'}));
 for(const collection of ['global_audit_logs','platform_audit_logs','platform_users'])await denied(`employee mutates ${collection}`,()=>updateDoc(doc(employee,collection,'existing'),{value:'forged'}));
 await denied('unverified allowlisted email crosses tenant boundary',()=>getDoc(doc(db('unverified',{email:'peterssentongo61@gmail.com',email_verified:false}),'staff','foreign')));
 assert.equal(cases.filter(c=>c.allowed).length,0,JSON.stringify(cases.filter(c=>c.allowed)));
 await assertSucceeds(updateDoc(doc(hr,'staff','employee'),{full_name:'Reviewed employee name'}));
 await assertSucceeds(updateDoc(doc(it,'system_settings','audit-a'),{displayLabel:'Normal IT settings edit'}));
 await assertSucceeds(setDoc(doc(hr,'staff','new-employee'),{tenantId:'audit-a',role:'Employee',secondaryRoles:[],roleRealmId:null}));
 await assertSucceeds(updateDoc(doc(owner,'staff','employee'),{role:'Finance Head'}));
 await assertSucceeds(updateDoc(doc(owner,'system_settings','audit-a'),{phase5SalarySettlementEnabled:true}));
 await assertSucceeds(setDoc(doc(owner,'role_realms_of_operation','owner-approved'),{tenantId:'audit-a',roleType:'custom',roleName:'Reviewed role',permissions:{finance:{accessLevel:'view_only'}}}));
 await assertSucceeds(getDoc(doc(db('verified-bootstrap',{email:'peterssentongo61@gmail.com',email_verified:true}),'staff','foreign')));
 const bootstrap=db('verified-bootstrap',{email:'peterssentongo61@gmail.com',email_verified:true});
 await assertSucceeds(setDoc(doc(bootstrap,'platform_users','linked-platform-admin'),{role:'super_operator',active:true}));
 await assertSucceeds(setDoc(doc(db('linked-platform-admin'),'tenants','approved-platform-tenant'),{name:'Approved platform tenant'}));
 console.log('Authority audit passed: privilege escalation and fallback bypasses denied; authorized operations preserved.');
}finally{await env.cleanup();}
