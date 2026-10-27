/** Scoped auditor probes; synthetic emulator data only. --observe records pre-repair exploits. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc,deleteDoc,getDoc} from 'firebase/firestore';
if(!process.env.FIRESTORE_EMULATOR_HOST)throw new Error('An isolated emulator is required.');
const env=await initializeTestEnvironment({projectId:'demo-phase6-authority-audit',firestore:{rules:readFileSync(process.env.PHARMHELM_TEST_RULES||'firestore.rules','utf8')}});
const tenantId='martin-audit',branchId='masaka-audit',observe=process.argv.includes('--observe')||process.env.PHASE6_AUDIT_OBSERVE==='1',results=[];
let operatorUid;
if(observe&&process.env.CI)throw new Error('Observation mode cannot certify CI.');
const actor=(uid,claims={})=>{operatorUid=uid;return env.authenticatedContext(uid,claims).firestore();};
async function seed(){await env.clearFirestore();await env.withSecurityRulesDisabled(async ctx=>{
 const db=ctx.firestore();
 for(const [uid,role,t,branches] of [['cleaner','Cleaner',tenantId,[branchId]],['dispenser','Dispenser',tenantId,[branchId]],['viewer','Marketing Personnel',tenantId,[branchId]],['foreign-finance','Finance Head','foreign',[branchId]],['finance','Finance Head',tenantId,[branchId]],['other-branch','Dispenser',tenantId,['other']],['owner','owner',tenantId,[]],['custom','Custom CRM',tenantId,[branchId]],['custom-view','Custom CRM View',tenantId,[branchId]],['custom-marketing','Custom Marketing',tenantId,[branchId]],['custom-finance','Custom Finance',tenantId,[branchId]],['custom-pos','Custom POS',tenantId,[branchId]]])await setDoc(doc(db,'staff',uid),{tenantId:t,role,assigned_branches:branches,status:'active',active:true,secondaryRoles:[]});
 for(const [c,id,data] of [['clients','patient',{tenantId,branch_id:branchId,patient_code:'PAT-000001',full_name:'Synthetic Patient',care_status:'active',welfare_spent:100,welfare_used_ytd:100,welfare_limit:1000}],['institutions','hospital',{tenantId,branch_id:branchId,institution_code:'INS-000001',supplier_name:'Synthetic Hospital',status:'active',role:'billable',payment_terms:'Net 30',credit_limit:100000}],...['supplier_payables','client_credit_ledger','institution_credit_ledger','supplier_credit_ledger'].map(c=>[c,'existing',{tenantId,branch_id:branchId,amount_ugx:1000,outstanding_ugx:1000}])])await setDoc(doc(db,c,id),data);
 for(const [role,level] of [['Custom CRM','view_functional'],['Custom CRM View','view_only']])await setDoc(doc(db,'role_realms_of_operation',`${tenantId}_${role.replace(/\s+/g,'_').toLowerCase()}`),{tenantId,roleType:'custom',roleName:role,permissions:{clients:{accessLevel:level}}});
 await setDoc(doc(db,'role_realms_of_operation',`${tenantId}_custom_marketing`),{tenantId,roleType:'custom',roleName:'Custom Marketing',permissions:{marketing:{accessLevel:'view_functional'}}});
 for(const [role,module] of [['Custom Finance','finance'],['Custom POS','sales']])await setDoc(doc(db,'role_realms_of_operation',`${tenantId}_${role.replace(/\s+/g,'_').toLowerCase()}`),{tenantId,roleType:'custom',roleName:role,permissions:{[module]:{accessLevel:'view_functional'}}});
});}
async function probe(id,allowed,fn){await seed();let accepted=false,error;try{await fn();accepted=true;}catch(e){error=e;}
 if(!accepted&&error?.code!=='permission-denied')throw error;
 let operatorProfile;await env.withSecurityRulesDisabled(async ctx=>{operatorProfile=(await getDoc(doc(ctx.firestore(),'staff',operatorUid))).data();});
 const result={id,operatorUid,operatorRole:operatorProfile.role,secondaryRoles:operatorProfile.secondaryRoles,operatorBranchIds:operatorProfile.assigned_branches,tenant:operatorUid==='foreign-finance'?'foreign':tenantId,branch:branchId,environment:'authenticated Firestore emulator',preconditions:'Synthetic active staff, debtor masters and legacy ledgers seeded; no live data',expected:allowed?'allowed':'denied',observed:accepted?'allowed':'denied',pass:accepted===allowed,commit:process.env.PHASE6_TEST_COMMIT||'local-working-tree'};results.push(result);console.log(`${result.pass?'PASS':'EXPLOIT'} ${id}: ${result.observed}`);if(!observe)assert.equal(accepted,allowed,id);
}
try{
 await probe('crm-no-access-cannot-edit-client',false,()=>updateDoc(doc(actor('cleaner'),'clients','patient'),{full_name:'Forged'}));
 await probe('crm-view-only-cannot-change-credit-policy',false,()=>updateDoc(doc(actor('viewer'),'institutions','hospital'),{credit_limit:999999999,payment_terms:'Net 90'}));
 await probe('crm-no-access-cannot-create-master',false,()=>setDoc(doc(actor('cleaner'),'clients','forged'),{tenantId,full_name:'Forged'}));
 await probe('crm-cannot-reset-welfare-spent',false,()=>updateDoc(doc(actor('dispenser'),'clients','patient'),{welfare_spent:0}));
 await probe('crm-cannot-reset-welfare-used',false,()=>updateDoc(doc(actor('dispenser'),'clients','patient'),{welfare_used_ytd:0}));
 await probe('crm-cannot-grant-welfare-allocation',false,()=>updateDoc(doc(actor('dispenser'),'clients','patient'),{welfare_allocation_ugx:99999999}));
 await probe('crm-cannot-create-financial-balances',false,()=>setDoc(doc(actor('dispenser'),'clients','forged'),{tenantId,branch_id:branchId,full_name:'Forged',welfare_spent:-100,welfare_limit:9999999}));
 await probe('crm-other-branch-cannot-edit-master',false,()=>updateDoc(doc(actor('other-branch'),'institutions','hospital'),{supplier_name:'Forged'}));
 await probe('crm-owner-cannot-delete-canonical-client',false,()=>deleteDoc(doc(actor('owner'),'clients','patient')));
 await probe('crm-owner-cannot-delete-canonical-institution',false,()=>deleteDoc(doc(actor('owner'),'institutions','hospital')));
 await probe('crm-client-identity-immutable',false,()=>updateDoc(doc(actor('dispenser'),'clients','patient'),{patient_code:'PAT-000099'}));
 await probe('crm-operator-contact-edit',true,()=>updateDoc(doc(actor('dispenser'),'clients','patient'),{full_name:'Updated Patient',phone_number:'0700000000'}));
 await probe('crm-operator-archive',true,()=>updateDoc(doc(actor('dispenser'),'institutions','hospital'),{status:'inactive'}));
 await probe('crm-foreign-master-read-denied',false,()=>getDoc(doc(actor('foreign-finance'),'clients','patient')));
 await probe('crm-token-role-forgery-denied',false,()=>updateDoc(doc(actor('cleaner',{role:'owner',tenantId}),'clients','patient'),{full_name:'Forged'}));
 await probe('crm-foreign-realm-denied',false,async()=>{await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),'role_realms_of_operation',`${tenantId}_custom_crm`),{tenantId:'foreign'}));await updateDoc(doc(actor('custom'),'clients','patient'),{full_name:'Forged'});});
 await probe('crm-custom-functional-contact-edit',true,()=>updateDoc(doc(actor('custom'),'clients','patient'),{phone_number:'0700111222'}));
 await probe('crm-custom-view-denied',false,()=>updateDoc(doc(actor('custom-view'),'clients','patient'),{phone_number:'0700111222'}));
 await probe('crm-owner-contact-edit',true,()=>updateDoc(doc(actor('owner'),'clients','patient'),{phone_number:'0700111222'}));
 await probe('crm-operator-client-create',true,()=>setDoc(doc(actor('dispenser'),'clients','new'),{tenantId,branch_id:branchId,patient_code:'PAT-000002',full_name:'New Patient'}));
 await probe('crm-secondary-role-contact-edit',true,async()=>{await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),'staff','cleaner'),{secondaryRoles:['Dispenser']}));await updateDoc(doc(actor('cleaner'),'clients','patient'),{phone_number:'0700111222'});});
 await probe('crm-inactive-operator-denied',false,async()=>{await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),'staff','dispenser'),{status:'inactive',active:false}));await updateDoc(doc(actor('dispenser'),'clients','patient'),{phone_number:'0700111222'});});
 await probe('crm-inactive-marketing-registration-denied',false,async()=>{await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),'staff','viewer'),{status:'inactive',active:false}));await setDoc(doc(actor('viewer'),'clients','inactive-new'),{tenantId,name:'Blocked',balance:0});});
 await probe('crm-marketing-custom-read',true,()=>getDoc(doc(actor('custom-marketing'),'clients','patient')));
 await probe('crm-marketing-custom-registration',true,()=>setDoc(doc(actor('custom-marketing'),'clients','custom-marketing-new'),{tenantId,name:'Marketing Patient',phone:'0700111222',type:'individual',sms_opt_in:true,balance:0,loyalty_points:0}));
 await probe('crm-marketing-custom-consent',true,()=>updateDoc(doc(actor('custom-marketing'),'clients','patient'),{sms_opt_in:true}));
 await probe('crm-custom-finance-read',true,()=>getDoc(doc(actor('custom-finance'),'clients','patient')));
 await probe('crm-custom-pos-read',true,()=>getDoc(doc(actor('custom-pos'),'institutions','hospital')));
 await probe('crm-custom-client-view-read',true,()=>getDoc(doc(actor('custom-view'),'clients','patient')));
 await probe('crm-no-access-client-read-denied',false,()=>getDoc(doc(actor('cleaner'),'clients','patient')));
 await probe('crm-tenant-reassignment-denied',false,()=>updateDoc(doc(actor('owner'),'institutions','hospital'),{tenantId:'foreign'}));
 await probe('crm-marketing-consent',true,()=>updateDoc(doc(actor('viewer'),'clients','patient'),{sms_opt_in:true,preferred_channel:'SMS'}));
 await probe('crm-marketing-client-registration',true,()=>setDoc(doc(actor('viewer'),'clients','marketing-new'),{tenantId,name:'Marketing Patient',phone:'0700111222',type:'individual',sms_opt_in:true,balance:0,loyalty_points:0}));
 await probe('crm-marketing-cannot-create-credit-policy',false,()=>setDoc(doc(actor('viewer'),'clients','marketing-forged'),{tenantId,name:'Marketing Patient',billing_type:'institutional-pay',institution_to_bill_id:'hospital'}));
 for(const amount of [-1,0.5,'1000',9007199254740992])await probe(`crm-malformed-limit-${amount}`,false,()=>updateDoc(doc(actor('owner'),'institutions','hospital'),{credit_limit:amount}));
 await probe('crm-unbounded-terms-denied',false,()=>updateDoc(doc(actor('owner'),'institutions','hospital'),{payment_terms:'X'.repeat(121)}));
 for(const c of ['supplier_payables','client_credit_ledger','institution_credit_ledger','supplier_credit_ledger']){
  await probe(`${c}-foreign-update`,false,()=>updateDoc(doc(actor('foreign-finance'),c,'existing'),{outstanding_ugx:0}));
  await probe(`${c}-foreign-create`,false,()=>setDoc(doc(actor('foreign-finance'),c,'forged'),{tenantId,amount_ugx:100000}));
  await probe(`${c}-foreign-delete`,false,()=>deleteDoc(doc(actor('foreign-finance'),c,'existing')));
  await probe(`${c}-same-tenant-rewrite-denied`,false,()=>updateDoc(doc(actor('finance'),c,'existing'),{outstanding_ugx:0}));
 }
 writeFileSync('/tmp/phase6-authority-audit-evidence.json',JSON.stringify({environment:'authenticated emulator',observe,results},null,2));
 console.log(`Auditor probes: ${results.filter(r=>r.pass).length}/${results.length} passed.`);
}finally{await env.cleanup();}
