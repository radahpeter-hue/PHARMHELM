import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,query,collection,where} from 'firebase/firestore';
const env=await initializeTestEnvironment({projectId:'pharmhelm-finance-l4-portfolio-test',firestore:{rules:readFileSync('firestore.rules','utf8')}});
const tenant='tenant_a',other='tenant_b';
const row=(uid,id='custom_emergency',tenantId=tenant)=>({
 id,tenantId,name:'Emergency Fund',classification:'restricted_internal_fund',
 description:'Reserved',scope:{kind:'organisation'},currency:'UGX',
 origin:'custom',status:'active',supportsChildAccounts:false,
 allowsTransfersIn:true,allowsTransfersOut:true,createdBy:uid,updatedBy:uid,
 createdAt:'2026-10-30T08:00:00Z',updatedAt:'2026-10-30T08:00:00Z'
});
const ref=(db,t=tenant,id='custom_emergency')=>doc(db,'finance_portfolios_v1',t+'__'+id);
try{
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async ctx=>{
  await Promise.all([
   setDoc(doc(ctx.firestore(),'staff','ceo_a'),{tenantId:tenant,role:'CEO',secondaryRoles:[],assigned_branches:[]}),
   setDoc(doc(ctx.firestore(),'staff','finance_a'),{tenantId:tenant,role:'Finance Head',secondaryRoles:[],assigned_branches:['masaka']}),
   setDoc(doc(ctx.firestore(),'staff','ceo_b'),{tenantId:other,role:'CEO',secondaryRoles:[],assigned_branches:[]})
  ]);
 });
 const ceo=env.authenticatedContext('ceo_a',{tenantId:tenant}).firestore();
 const finance=env.authenticatedContext('finance_a',{tenantId:tenant}).firestore();
 const otherDb=env.authenticatedContext('ceo_b',{tenantId:other}).firestore();
 await assertSucceeds(setDoc(ref(ceo),row('ceo_a')));
 await assertSucceeds(getDoc(ref(finance)));
 await assertSucceeds(getDocs(query(collection(finance,'finance_portfolios_v1'),where('tenantId','==',tenant),where('scope.kind','==','organisation'))));
 await assertSucceeds(setDoc(ref(ceo,tenant,'masaka_fund'),{...row('ceo_a','masaka_fund'),scope:{kind:'branch',branchId:'masaka'}}));
 await assertSucceeds(getDoc(ref(finance,tenant,'masaka_fund')));
 await assertSucceeds(getDocs(query(collection(finance,'finance_portfolios_v1'),where('tenantId','==',tenant),where('scope.kind','==','branch'),where('scope.branchId','==','masaka'))));
 await assertFails(setDoc(ref(finance,tenant,'custom_denied'),row('finance_a','custom_denied')));
 await assertFails(setDoc(ref(otherDb),row('ceo_b')));
 await assertFails(getDoc(ref(otherDb)));
 await assertFails(setDoc(ref(ceo,tenant,'custom_invalid'),{...row('ceo_a','custom_invalid'),origin:'system'}));
 await assertFails(setDoc(ref(ceo,tenant,'custom_invalid_balance'),{...row('ceo_a','custom_invalid_balance'),balanceUGX:100}));
 console.log('Finance Level 4 portfolio isolation and CEO-only create rules PASSED');
}finally{await env.cleanup();}
