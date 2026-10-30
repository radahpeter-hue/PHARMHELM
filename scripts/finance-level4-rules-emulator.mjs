import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc,deleteDoc,deleteField,getDoc,getDocs,query,collection,where} from 'firebase/firestore';
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
   setDoc(doc(ctx.firestore(),'staff','ceo_b'),{tenantId:other,role:'CEO',secondaryRoles:[],assigned_branches:[]}),
   setDoc(doc(ctx.firestore(),'system_settings',tenant),{tenantId:tenant,managementCashAccountControlV1:true}),
   setDoc(doc(ctx.firestore(),'branches','masaka'),{tenantId:tenant,name:'Masaka'})
  ]);
 });
 const ceo=env.authenticatedContext('ceo_a',{tenantId:tenant}).firestore();
 const finance=env.authenticatedContext('finance_a',{tenantId:tenant}).firestore();
 const otherDb=env.authenticatedContext('ceo_b',{tenantId:other}).firestore();
 await assertSucceeds(setDoc(ref(ceo),row('ceo_a')));
 await assertSucceeds(getDoc(ref(finance)));
 await assertSucceeds(getDocs(query(collection(finance,'finance_portfolios_v1'),where('tenantId','==',tenant),where('scope.kind','==','organisation'))));
 await assertFails(setDoc(ref(ceo,tenant,'masaka_fund'),{...row('ceo_a','masaka_fund'),scope:{kind:'branch',branchId:'masaka'}}));


 await assertFails(setDoc(ref(finance,tenant,'custom_denied'),row('finance_a','custom_denied')));
 await assertFails(setDoc(ref(otherDb),row('ceo_b')));
 await assertFails(getDoc(ref(otherDb)));
 await assertFails(setDoc(ref(ceo,tenant,'custom_invalid'),{...row('ceo_a','custom_invalid'),origin:'system'}));
 await assertFails(setDoc(ref(ceo,tenant,'custom_invalid_balance'),{...row('ceo_a','custom_invalid_balance'),balanceUGX:100}));
 await assertFails(setDoc(ref(ceo,tenant,'system_bank'),{...row('ceo_a','system_bank'),name:'Bank',origin:'system',supportsChildAccounts:true,classification:'bank'}));
 await assertFails(setDoc(ref(ceo,tenant,'system_invalid'),{...row('ceo_a','system_invalid'),origin:'system'}));
 const account=(actor,tenantId=tenant)=>({
   id:'bank_test123',tenantId,portfolioId:'system_bank',displayName:'Equity Operating',
   institution:'Equity Bank',accountReference:'123456',currency:'UGX',
   scope:{kind:'organisation'},status:'active',createdBy:actor,createdAt:'2026-10-30T08:00:00Z',
   balanceUGX:0,openingBalanceUGX:0,initialized:false
 });
 const aref=(db,t=tenant)=>doc(db,'finance_portfolio_accounts_v1',t+'__bank_test123');
 await assertFails(setDoc(aref(ceo),account('ceo_a')));
 await assertFails(getDoc(aref(finance)));
 await assertFails(setDoc(aref(ceo),account('ceo_a')));
 await assertFails(setDoc(doc(finance,'finance_portfolio_accounts_v1',tenant+'__bank_staff'),{...account('finance_a'),id:'bank_staff'}));
 await assertFails(setDoc(aref(otherDb),account('ceo_b')));
 await assertFails(setDoc(doc(ceo,'finance_portfolio_accounts_v1',tenant+'__bank_fake'),{...account('ceo_a'),id:'bank_fake',balanceUGX:100}));

 const bank={...row('ceo_a','bank_opaque_1'),classification:'bank',name:'Equity Operating',
  description:'Bank identity',bankInstitution:'EQUITY',bankAccountReference:'123456',
  bankParentId:'system_bank',allowsTransfersIn:false,allowsTransfersOut:false};
 await assertSucceeds(setDoc(ref(ceo,tenant,bank.id),bank));
 await assertSucceeds(getDoc(ref(finance,tenant,bank.id)));
 await assertSucceeds(setDoc(ref(ceo,tenant,bank.id),bank)); // Idempotent identical identity
 await assertFails(setDoc(ref(ceo,tenant,bank.id),{...bank,name:'Changed bank'}));
 await assertFails(updateDoc(ref(finance,tenant,bank.id),{status:'inactive',updatedBy:'finance_a'}));
 await assertFails(updateDoc(ref(ceo,tenant,bank.id),{bankAccountReference:'9999'}));
 await assertSucceeds(updateDoc(ref(ceo,tenant,bank.id),{status:'inactive',updatedBy:'ceo_a',
 updatedAt:'2026-10-30T09:00:00Z',deactivatedBy:'ceo_a',deactivatedAt:'2026-10-30T09:00:00Z',deactivationReason:'closed'}));
 await assertFails(updateDoc(ref(otherDb,tenant,bank.id),{status:'active',updatedBy:'ceo_b'}));
 await assertSucceeds(updateDoc(ref(ceo,tenant,bank.id),{status:'active',updatedBy:'ceo_a',
 updatedAt:'2026-10-30T10:00:00Z',deactivatedBy:deleteField(),deactivatedAt:deleteField(),deactivationReason:deleteField()}));
 await assertFails(deleteDoc(ref(ceo,tenant,bank.id)));

 const id='bank_'+ 'a'.repeat(64);
 const bankRegistry={...row('ceo_a',id),classification:'bank',name:'Registered Equity',
  description:'Registered bank',bankInstitution:'EQUITY',bankAccountReference:'987655123',
  bankParentId:'system_bank',allowsTransfersIn:false,allowsTransfersOut:false};
 await assertSucceeds(setDoc(ref(ceo,tenant,id),bankRegistry));
 const ar=doc(ceo,'finance_payment_accounts',tenant+'_'+id);
 const funding={tenantId:tenant,accountId:id,portfolioId:id,kind:'bank',
  portfolioClassification:'bank',scope:{kind:'organisation'},name:'Equity Operating',
  currency:'UGX',initialized:true,openingBalanceUGX:100,balanceUGX:100,
  reconciliationReference:'EQ-STATEMENT-001',registeredBy:'ceo_a',
  lastPostingId:null,controlVersion:1};
 await assertFails(setDoc(doc(ceo,'finance_payment_accounts',tenant+'_bank_'+'b'.repeat(64)),
  {...funding,accountId:'bank_'+'b'.repeat(64),portfolioId:'bank_'+'b'.repeat(64)}));
 await assertSucceeds(setDoc(ar,funding));
 await assertSucceeds(getDoc(doc(finance,'finance_payment_accounts',tenant+'_'+id)));
 await assertFails(setDoc(doc(finance,'finance_payment_accounts',tenant+'_bank_'+'b'.repeat(64)),{...funding,accountId:'bank_'+'b'.repeat(64),portfolioId:'bank_'+'b'.repeat(64),registeredBy:'finance_a'}));
 const movementId='portfolio_bank_test_payment';
 const entry={tenantId:tenant,portfolioId:id,accountDocumentId:ar.id,
  accountDeltaUGX:50,amount:50,type:'incoming',source:'Portfolio reconciled movement',
  postedBy:'finance_a',reference_number:'BANK-STMT-POST-01',createdAt:'2026-10-30',updatedAt:'2026-10-30'};
 const fbatch=writeBatch(finance);
 fbatch.set(doc(finance,'banking_records',movementId),entry);
 fbatch.update(doc(finance,'finance_payment_accounts',tenant+'_'+id),{balanceUGX:increment(50),lastPostingId:movementId,updatedAt:'2026-10-30'});
 await assertSucceeds(fbatch.commit());
 await assertFails(setDoc(doc(finance,'banking_records','forged_deposit'),{...entry,accountDeltaUGX:999,amount:999}));
 await assertFails(updateDoc(doc(finance,'finance_payment_accounts',tenant+'_'+id),{balanceUGX:1000000}));
 await assertFails(getDoc(doc(otherDb,'finance_payment_accounts',tenant+'_'+id)));
 const momoId='system_mtn_mobile_money';
 const momoRef=doc(ceo,'finance_payment_accounts',tenant+'_'+momoId);
 await assertSucceeds(setDoc(momoRef,{...funding,accountId:momoId,portfolioId:momoId,
  portfolioClassification:'mobile_money',kind:'bank',scope:{kind:'organisation'},openingBalanceUGX:0,balanceUGX:0}));
 await assertFails(setDoc(doc(finance,'finance_payment_accounts',tenant+'_system_airtel_mobile_money'),{
  ...funding,accountId:'system_airtel_mobile_money',portfolioId:'system_airtel_mobile_money',
  kind:'bank',portfolioClassification:'mobile_money',registeredBy:'finance_a'}));
 const pettyId='system_petty_cash_masaka';
 await assertSucceeds(setDoc(doc(ceo,'finance_payment_accounts',tenant+'_'+pettyId),{
  ...funding,accountId:pettyId,portfolioId:pettyId,kind:'petty_cash',
  portfolioClassification:'petty_cash',scope:{kind:'branch',branchId:'masaka'},openingBalanceUGX:0,balanceUGX:0}));

 console.log('Finance Level 4 custom portfolio role/isolation PASSED; built-in and bank registrations remain fail-closed');
}finally{await env.cleanup();}
