import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc,deleteDoc,deleteField,getDoc,getDocs,query,collection,where,writeBatch,increment} from 'firebase/firestore';
const env=await initializeTestEnvironment({projectId:'pharmhelm-finance-l4-portfolio-test',firestore:{rules:readFileSync('firestore.rules','utf8')}});
const originalAssertSucceeds=assertSucceeds;
let successStep=0;
const checkedSucceeds=async promise=>{const step=++successStep;try{return await originalAssertSucceeds(promise);}catch(error){console.error('Finance Level 4 emulator unexpected denial at successful-operation step',step);throw error;}};
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
 await checkedSucceeds(setDoc(ref(ceo),row('ceo_a')));
 await checkedSucceeds(getDoc(ref(finance)));
 await checkedSucceeds(getDocs(query(collection(finance,'finance_portfolios_v1'),where('tenantId','==',tenant),where('scope.kind','==','organisation'))));
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
 await checkedSucceeds(setDoc(ref(ceo,tenant,bank.id),bank));
 await checkedSucceeds(getDoc(ref(finance,tenant,bank.id)));
 await assertFails(setDoc(ref(ceo,tenant,bank.id),bank)); // Identity writes are create-only; existing records are immutable
 await assertFails(setDoc(ref(ceo,tenant,bank.id),{...bank,name:'Changed bank'}));
 await assertFails(updateDoc(ref(finance,tenant,bank.id),{status:'inactive',updatedBy:'finance_a'}));
 await assertFails(updateDoc(ref(ceo,tenant,bank.id),{bankAccountReference:'9999'}));
 await checkedSucceeds(updateDoc(ref(ceo,tenant,bank.id),{status:'inactive',updatedBy:'ceo_a',
 updatedAt:'2026-10-30T09:00:00Z',deactivatedBy:'ceo_a',deactivatedAt:'2026-10-30T09:00:00Z',deactivationReason:'closed'}));
 await assertFails(updateDoc(ref(otherDb,tenant,bank.id),{status:'active',updatedBy:'ceo_b'}));
 await checkedSucceeds(updateDoc(ref(ceo,tenant,bank.id),{status:'active',updatedBy:'ceo_a',
 updatedAt:'2026-10-30T10:00:00Z',deactivatedBy:deleteField(),deactivatedAt:deleteField(),deactivationReason:deleteField()}));
 await assertFails(deleteDoc(ref(ceo,tenant,bank.id)));

 const id='bank_'+ 'a'.repeat(64);
 const bankRegistry={...row('ceo_a',id),classification:'bank',name:'Registered Equity',
  description:'Registered bank',bankInstitution:'EQUITY',bankAccountReference:'987655123',
  bankParentId:'system_bank',allowsTransfersIn:false,allowsTransfersOut:false};
 await checkedSucceeds(setDoc(ref(ceo,tenant,id),bankRegistry));
 const ar=doc(ceo,'finance_payment_accounts',tenant+'_'+id);
 const funding={tenantId:tenant,accountId:id,portfolioId:id,kind:'bank',
  portfolioClassification:'bank',scope:{kind:'organisation'},name:'Equity Operating',
  currency:'UGX',initialized:true,openingBalanceUGX:100,balanceUGX:100,
  reconciliationReference:'EQ-STATEMENT-001',registeredBy:'ceo_a',
  lastPostingId:null,controlVersion:1};
 await assertFails(setDoc(doc(ceo,'finance_payment_accounts',tenant+'_bank_'+'b'.repeat(64)),
  {...funding,accountId:'bank_'+'b'.repeat(64),portfolioId:'bank_'+'b'.repeat(64)}));
 await checkedSucceeds(setDoc(ar,funding));
 await assertFails(updateDoc(ref(ceo,tenant,id),{
  status:'inactive',updatedBy:'ceo_a',updatedAt:'2026-10-30T09:00:00Z',
  deactivatedBy:'ceo_a',deactivatedAt:'2026-10-30T09:00:00Z',deactivationReason:'Funded cannot retire'
 }));

 await assertFails(updateDoc(ref(ceo,tenant,id),{
  status:'inactive',updatedBy:'ceo_a',updatedAt:'2026-10-30T10:00:00Z',
  deactivatedBy:'ceo_a',deactivatedAt:'2026-10-30T10:00:00Z',
  deactivationReason:'Cannot close a funded bank'
 }));

 await checkedSucceeds(getDoc(doc(finance,'finance_payment_accounts',tenant+'_'+id)));
 await assertFails(setDoc(doc(finance,'finance_payment_accounts',tenant+'_bank_'+'b'.repeat(64)),{...funding,accountId:'bank_'+'b'.repeat(64),portfolioId:'bank_'+'b'.repeat(64),registeredBy:'finance_a'}));
 // Idempotent posting must be able to inspect an absent ledger ID without
 // granting arbitrary cross-tenant reads of an existing posting.
 await checkedSucceeds(getDoc(doc(finance,'banking_records','portfolio_missing_posting')));
 await checkedSucceeds(getDoc(doc(finance,'petty_cash_ledger','portfolio_missing_cash_posting')));
 const movementId='portfolio_bank_test_payment';
 const entry={tenantId:tenant,portfolioId:id,accountDocumentId:ar.id,
  accountDeltaUGX:50,amount:50,type:'incoming',source:'Portfolio reconciled movement',
  postedBy:'finance_a',reference_number:'BANK-STMT-POST-01',createdAt:'2026-10-30',updatedAt:'2026-10-30'};
 const fbatch=writeBatch(finance);
 fbatch.set(doc(finance,'banking_records',movementId),entry);
 fbatch.update(doc(finance,'finance_payment_accounts',tenant+'_'+id),{balanceUGX:increment(50),lastPostingId:movementId,updatedAt:'2026-10-30'});
 await checkedSucceeds(fbatch.commit());
 await assertFails(setDoc(doc(finance,'banking_records','forged_deposit'),{...entry,accountDeltaUGX:999,amount:999}));
 await assertFails(updateDoc(doc(finance,'finance_payment_accounts',tenant+'_'+id),{balanceUGX:1000000}));
 await assertFails(getDoc(doc(otherDb,'finance_payment_accounts',tenant+'_'+id)));
 const momoId='system_mtn_mobile_money';
 const momoRef=doc(ceo,'finance_payment_accounts',tenant+'_'+momoId);
 await checkedSucceeds(setDoc(momoRef,{...funding,accountId:momoId,portfolioId:momoId,
  portfolioClassification:'mobile_money',kind:'bank',scope:{kind:'organisation'},openingBalanceUGX:0,balanceUGX:0}));
 await assertFails(setDoc(doc(finance,'finance_payment_accounts',tenant+'_system_airtel_mobile_money'),{
  ...funding,accountId:'system_airtel_mobile_money',portfolioId:'system_airtel_mobile_money',
  kind:'bank',portfolioClassification:'mobile_money',registeredBy:'finance_a'}));
 const pettyId='system_petty_cash_masaka';
 await checkedSucceeds(setDoc(doc(ceo,'finance_payment_accounts',tenant+'_'+pettyId),{
  ...funding,accountId:pettyId,portfolioId:pettyId,kind:'petty_cash',
  portfolioClassification:'petty_cash',scope:{kind:'branch',branchId:'masaka'},openingBalanceUGX:0,balanceUGX:0}));


 const pettyRef=doc(ceo,'finance_payment_accounts',tenant+'_'+pettyId);
 const outId='portfolio_petty_out_01';
 const outEntry={tenantId:tenant,portfolioId:pettyId,accountDocumentId:pettyRef.id,
  accountDeltaUGX:-20,amount:20,type:'outgoing',source:'Portfolio reconciled movement',
  postedBy:'finance_a',reference_number:'PETTY-OUT-01',createdAt:'2026-10-30',updatedAt:'2026-10-30'};
 const overdraft=writeBatch(finance);
 overdraft.set(doc(finance,'petty_cash_ledger',outId),outEntry);
 overdraft.update(doc(finance,'finance_payment_accounts',pettyRef.id),{balanceUGX:increment(-20),lastPostingId:outId,updatedAt:'2026-10-30'});
 await assertFails(overdraft.commit());
 const validId='portfolio_petty_in_01';
 const incoming=writeBatch(finance);
 incoming.set(doc(finance,'petty_cash_ledger',validId),{...outEntry,accountDeltaUGX:50,amount:50,type:'incoming',reference_number:'PETTY-IN-01'});
 incoming.update(doc(finance,'finance_payment_accounts',pettyRef.id),{balanceUGX:increment(50),lastPostingId:validId,updatedAt:'2026-10-30'});
 await checkedSucceeds(incoming.commit());
 const replay=writeBatch(finance);
 replay.set(doc(finance,'petty_cash_ledger',validId),{...outEntry,accountDeltaUGX:50,amount:50,type:'incoming',reference_number:'PETTY-IN-01'});
 replay.update(doc(finance,'finance_payment_accounts',pettyRef.id),{balanceUGX:increment(50),lastPostingId:validId,updatedAt:'2026-10-30'});
 await assertFails(replay.commit());
 const foreign=writeBatch(finance);
 foreign.set(doc(finance,'petty_cash_ledger','portfolio_foreign_01'),{...outEntry,tenantId:other,accountDeltaUGX:50,amount:50,type:'incoming'});
 foreign.update(doc(finance,'finance_payment_accounts',pettyRef.id),{balanceUGX:increment(50),lastPostingId:'portfolio_foreign_01',updatedAt:'2026-10-30'});
 await assertFails(foreign.commit());

 const transferDebit='pf_d_pairtest',transferCredit='pf_c_pairtest';
 const transfer=writeBatch(finance);
 transfer.set(doc(finance,'banking_records',transferDebit),{
  ...entry,accountDeltaUGX:-20,amount:20,type:'outgoing',
  reference_number:'TRANSFER-EQUITY-MASAKA',transferCounterparty:pettyRef.id,linkedMovementId:transferCredit});
 transfer.update(doc(finance,'finance_payment_accounts',ar.id),{balanceUGX:increment(-20),lastPostingId:transferDebit,updatedAt:'2026-10-30'});
 transfer.set(doc(finance,'petty_cash_ledger',transferCredit),{
  ...outEntry,accountDeltaUGX:20,amount:20,type:'incoming',
  reference_number:'TRANSFER-EQUITY-MASAKA',transferCounterparty:ar.id,linkedMovementId:transferDebit});
 transfer.update(doc(finance,'finance_payment_accounts',pettyRef.id),{balanceUGX:increment(20),lastPostingId:transferCredit,updatedAt:'2026-10-30'});
 await checkedSucceeds(transfer.commit());
 const bankAfter=await getDoc(ar),pettyAfter=await getDoc(pettyRef);
 if(bankAfter.data().balanceUGX!==130||pettyAfter.data().balanceUGX!==70)
  throw new Error('Atomic portfolio transfer conservation failed.');
 await assertFails(setDoc(doc(finance,'banking_records',transferDebit),{...entry,amount:20,accountDeltaUGX:-20,type:'outgoing'}));
 // Lifecycle repair: unused removal keeps a terminal audit identity and cannot mint funds.
 const unusedId='unused_lifecycle';
 const unusedRef=ref(ceo,tenant,unusedId);
 const close={status:'inactive',updatedBy:'ceo_a',updatedAt:'2026-11-05T09:00:00Z',
  deactivatedBy:'ceo_a',deactivatedAt:'2026-11-05T09:00:00Z',deactivationReason:'Closed'};
 const remove={removed:true,removalReason:'Unused duplicate',
  updatedBy:'ceo_a',updatedAt:'2026-11-05T10:00:00Z'};
 await checkedSucceeds(setDoc(unusedRef,row('ceo_a',unusedId)));
 await assertFails(updateDoc(unusedRef,remove)); // Must deactivate first.
 await assertFails(setDoc(ref(ceo,tenant,'removed_on_create'),{...row('ceo_a','removed_on_create'),...remove}));
 await checkedSucceeds(updateDoc(unusedRef,close));
 await assertFails(updateDoc(ref(finance,tenant,unusedId),{...remove,updatedBy:'finance_a'}));
 await assertFails(updateDoc(ref(otherDb,tenant,unusedId),{...remove,updatedBy:'ceo_b'}));
 await checkedSucceeds(updateDoc(unusedRef,remove));
 await assertFails(updateDoc(unusedRef,{status:'active',updatedBy:'ceo_a'}));
 await assertFails(updateDoc(unusedRef,{removed:deleteField()}));
 await assertFails(setDoc(unusedRef,row('ceo_a',unusedId)));
 await assertFails(deleteDoc(unusedRef));
 await assertFails(setDoc(doc(ceo,'finance_payment_accounts',tenant+'_'+unusedId),{
  ...funding,accountId:unusedId,portfolioId:unusedId}));
 const inactiveId='inactive_unfunded';
 await checkedSucceeds(setDoc(ref(ceo,tenant,inactiveId),row('ceo_a',inactiveId)));
 await checkedSucceeds(updateDoc(ref(ceo,tenant,inactiveId),close));
 await assertFails(setDoc(doc(ceo,'finance_payment_accounts',tenant+'_'+inactiveId),{
  ...funding,accountId:inactiveId,portfolioId:inactiveId}));
 const parentId='unused_parent';
 await checkedSucceeds(setDoc(ref(ceo,tenant,parentId),{...row('ceo_a',parentId),supportsChildAccounts:true}));
 await checkedSucceeds(updateDoc(ref(ceo,tenant,parentId),close));
 await assertFails(updateDoc(ref(ceo,tenant,parentId),remove));
 // A real outgoing movement empties the used bank without deleting its history.
 const emptyId='lifecycle_empty_bank';
 const empty=writeBatch(finance);
 empty.set(doc(finance,'banking_records',emptyId),{...entry,type:'outgoing',amount:130,
  accountDeltaUGX:-130,reference_number:'CLOSE-TEST-001'});
 empty.update(doc(finance,'finance_payment_accounts',ar.id),{balanceUGX:0,lastPostingId:emptyId,updatedAt:'2026-11-05'});
 await checkedSucceeds(empty.commit());
 await assertFails(updateDoc(ref(finance,tenant,id),{...close,updatedBy:'finance_a',deactivatedBy:'finance_a'}));
 await assertFails(updateDoc(ref(otherDb,tenant,id),{...close,updatedBy:'ceo_b',deactivatedBy:'ceo_b'}));
 await checkedSucceeds(updateDoc(ref(ceo,tenant,id),close));
 await assertFails(updateDoc(ref(ceo,tenant,id),remove)); // Ever-reconciled is never unused.
 const blockedId='inactive_bank_deposit';
 const blocked=writeBatch(finance);
 blocked.set(doc(finance,'banking_records',blockedId),{...entry,amount:10,accountDeltaUGX:10});
 blocked.update(doc(finance,'finance_payment_accounts',ar.id),{balanceUGX:10,lastPostingId:blockedId,updatedAt:'2026-11-05'});
 await assertFails(blocked.commit());
 if((await getDoc(ar)).data().balanceUGX!==0||(await getDoc(doc(finance,'banking_records',blockedId))).exists())
  throw Error('Inactive account posting must fail atomically.');
 await checkedSucceeds(updateDoc(ref(ceo,tenant,id),{status:'active',updatedBy:'ceo_a',updatedAt:'2026-11-05T11:00:00Z',
  deactivatedBy:deleteField(),deactivatedAt:deleteField(),deactivationReason:deleteField()}));
 if(!(await getDoc(doc(finance,'banking_records',emptyId))).exists()||!(await getDoc(doc(finance,'banking_records',transferDebit))).exists())
  throw Error('Lifecycle must retain original ledger history.');
 // A same-batch deposit cannot bypass the zero balance closure gate.
 const raced=writeBatch(ceo),racedId='close_and_deposit';
 raced.update(ref(ceo,tenant,id),close);
 raced.set(doc(ceo,'banking_records',racedId),{...entry,postedBy:'ceo_a',amount:10,accountDeltaUGX:10});
 raced.update(ar,{balanceUGX:10,lastPostingId:racedId,updatedAt:'2026-11-05'});
 await assertFails(raced.commit());
 if((await getDoc(ref(ceo,tenant,id))).data().status!=='active'||(await getDoc(ar)).data().balanceUGX!==0)
  throw Error('Racing close and posting changed state.');
 console.log('Finance Level 4 lifecycle repair PASSED: zero-balance closure, reactivation, immutable histories, unused removal, inactive posting/funding rejection, tenant/RBAC and atomic closure race.');
}finally{await env.cleanup();}
