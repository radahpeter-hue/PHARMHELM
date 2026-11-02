import {readFileSync} from 'node:fs';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,query,where} from 'firebase/firestore';
import {settleReconciledEod} from '../src/domain/finance/eodPortfolioSettlement.ts';
import {eodIdentity} from '../src/utils/eodShifts.ts';
const env=await initializeTestEnvironment({
 projectId:'pharmhelm-eod-posting-acceptance',
 firestore:{rules:readFileSync('firestore.rules','utf8')}
});
const tenant='tenant_a',branchId='masaka';
const bankId='bank_'+('a'.repeat(64));
const accounts=[
 {id:'system_branch_cash_sales_masaka',kind:'petty_cash',classification:'cash_equivalent',amount:120},
 {id:'system_mtn_mobile_money',kind:'bank',classification:'mobile_money',amount:230},
 {id:'system_airtel_mobile_money',kind:'bank',classification:'mobile_money',amount:340},
 {id:bankId,kind:'bank',classification:'bank',amount:450}
];
function eod(date){
 const id=eodIdentity(tenant,branchId,date,'dayShift');
 return {id,record:{tenantId:tenant,branch_id:branchId,reconciliation_date:date,shift_id:'dayShift',
  status:'submitted',audit_only:true,financial_posting:'none',card_settlement_account_id:bankId,
  cash_actual:120,momo_actual:230,airtel_actual:340,card_actual:450}};
}
async function seed(){
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  await setDoc(doc(db,'staff','finance_a'),{tenantId:tenant,role:'Finance Head',secondaryRoles:[],assigned_branches:[branchId]});
  await setDoc(doc(db,'staff','outsider'),{tenantId:'tenant_b',role:'Finance Head',secondaryRoles:[],assigned_branches:[]});
  await setDoc(doc(db,'branches',branchId),{tenantId:tenant,name:'Masaka',cardSettlement:{tenantId:tenant,branchId,bankPortfolioId:bankId}});
  const audit=eod('2026-11-02');
  await setDoc(doc(db,'eod_reconciliations',audit.id),audit.record);
  for(const a of accounts){
   await setDoc(doc(db,'finance_payment_accounts',tenant+'_'+a.id),{
    tenantId:tenant,accountId:a.id,portfolioId:a.id,portfolioClassification:a.classification,
    kind:a.kind,initialized:true,currency:'UGX',balanceUGX:0,openingBalanceUGX:0,
    reconciliationReference:'EOD-TEST-OPENING',lastPostingId:null,name:a.id
   });
  }
 });
}
function ok(condition,message){if(!condition)throw Error(message);}
try{
 await env.clearFirestore();
 await seed();
 const finance=env.authenticatedContext('finance_a',{tenantId:tenant}).firestore();
 const outsider=env.authenticatedContext('outsider',{tenantId:'tenant_b'}).firestore();
 const id=eod('2026-11-02').id;
 const input={tenantId:tenant,branchId,reconciliationId:id,actorId:'finance_a'};
 const first=await settleReconciledEod(input,finance);
 ok(!first.replayed&&first.postings===4,'First settlement should post four movements');
 const replay=await settleReconciledEod(input,finance);
 ok(replay.replayed&&replay.postings===0,'Retry must not post twice');
 for(const a of accounts){
  const snap=await getDoc(doc(finance,'finance_payment_accounts',tenant+'_'+a.id));
  ok(snap.data()?.balanceUGX===a.amount,'Incorrect account balance '+a.id);
  const ledger=a.kind==='bank'?'banking_records':'petty_cash_ledger';
  const rows=await getDocs(query(collection(finance,ledger),where('tenantId','==',tenant),where('accountDocumentId','==',tenant+'_'+a.id)));
  ok(rows.size===1,'Expected exactly one paired journal movement '+a.id);
  ok(rows.docs[0].data().branchId===branchId,'Missing origin branch '+a.id);
 }
 let denied=false;
 try{await settleReconciledEod({...input,actorId:'outsider'},outsider);}catch{denied=true;}
 ok(denied,'Cross-tenant EOD settlement must be denied');
 const second=eod('2026-11-03');
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  await setDoc(doc(db,'eod_reconciliations',second.id),second.record);
  const {deleteDoc}=await import('firebase/firestore');
  await deleteDoc(doc(db,'finance_payment_accounts',tenant+'_system_airtel_mobile_money'));
 });
 let failed=false;
 try{await settleReconciledEod({...input,reconciliationId:second.id},finance);}catch{failed=true;}
 ok(failed,'Unreconciled destination must reject entire settlement');
 for(const a of accounts.filter(a=>a.id!=='system_airtel_mobile_money')){
  const snap=await getDoc(doc(finance,'finance_payment_accounts',tenant+'_'+a.id));
  ok(snap.data()?.balanceUGX===a.amount,'Partial posting changed balance '+a.id);
 }
 console.log('EOD four-channel posting, replay, tenant isolation and atomic failure PASSED');
}finally{await env.cleanup();}
