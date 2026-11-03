import {correctEod} from '../src/services/eodCorrectionService.ts';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,updateDoc,deleteDoc} from 'firebase/firestore';
import {submitEod} from '../src/services/eodSubmissionService.ts';
const env=await initializeTestEnvironment({projectId:'pharmhelm-eod-auto-test',firestore:{rules:readFileSync('firestore.rules','utf8')}});
const tenantId='tenant_a',branch_id='masaka',uid='branch_operator',bank='bank_'+ 'a'.repeat(64);
const targets=[['system_branch_cash_sales_masaka','petty_cash',120],['system_mtn_mobile_money','bank',230],['system_airtel_mobile_money','bank',340],[bank,'bank',450]];
const input={tenantId,branch_id,reconciliation_date:'2026-11-02',shift_id:'dayShift',shift_name:'Day',shift_start:'08:00',shift_end:'17:00',cash_actual:120,cash_expected:120,momo_actual:230,momo_expected:230,airtel_actual:340,airtel_expected:340,card_actual:450,card_expected:450};
for(const c of ['insurance','institutional_credit','staff_welfare']){input[c+'_actual']=0;input[c+'_expected']=0;}
try{
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  await setDoc(doc(db,'staff',uid),{tenantId,role:'Branch Manager',assigned_branches:[branch_id]});
  await setDoc(doc(db,'staff','it_head'),{tenantId,role:'IT Head'});
  await setDoc(doc(db,'staff','other'),{tenantId,role:'Branch Manager',assigned_branches:['other']});
  await setDoc(doc(db,'branches',branch_id),{tenantId,shifts:{dayShift:{enabled:true,startTime:'08:00',endTime:'17:00'}},cardSettlement:{bankPortfolioId:bank}});
  for(const [accountId,kind] of targets)await setDoc(doc(db,'finance_payment_accounts',tenantId+'_'+accountId),{tenantId,accountId,portfolioId:accountId,portfolioClassification:kind==='bank'?'bank':'cash_equivalent',kind,initialized:true,currency:'UGX',balanceUGX:0,openingBalanceUGX:0,reconciliationReference:'TEST-OPENING',lastPostingId:null});
 });
 const db=env.authenticatedContext(uid,{tenantId}).firestore();
 const results=await Promise.all([submitEod(input,{uid,tenantId},db),submitEod(input,{uid,tenantId},db)]);
 assert.equal(results.filter(r=>!r.replayed).length,1);
 const retry=await submitEod(input,{uid,tenantId},db);assert.equal(retry.replayed,true);
 for(const [id,,amount] of targets)assert.equal((await getDoc(doc(db,'finance_payment_accounts',tenantId+'_'+id))).data().balanceUGX,amount);
 await assertFails(setDoc(doc(db,'eod_reconciliations','eod~tenant_a~masaka~2026-11-05~dayShift'),{...input,reconciliation_date:'2026-11-05',financial_posting:'portfolios_v1'}));
 await assertFails(updateDoc(doc(db,'finance_payment_accounts',tenantId+'_'+bank),{balanceUGX:999999}));
 const other=env.authenticatedContext('other',{tenantId}).firestore();
 await assert.rejects(submitEod({...input,reconciliation_date:'2026-11-03'},{uid:'other',tenantId},other));
 const it=env.authenticatedContext('it_head',{tenantId}).firestore();
 const auditId='eod~tenant_a~masaka~2026-11-02~dayShift';
 await assertFails(updateDoc(doc(it,'eod_reconciliations',auditId),{cash_actual:999,cash_variance:879,correction_reason:'unpaired',corrected_by:'it_head',corrected_at:new Date()}));
 await correctEod(auditId,{uid:'it_head',tenantId,role:'IT Head'},{cash:100,momo:200,airtel:300,card:400,insurance:0,institutional_credit:0,staff_welfare:0},'Correct declared collections',it);
 for(const [index,[accountId]] of targets.entries())assert.equal((await getDoc(doc(db,'finance_payment_accounts',tenantId+'_'+accountId))).data().balanceUGX,[100,200,300,400][index]);
 await env.withSecurityRulesDisabled(c=>deleteDoc(doc(c.firestore(),'finance_payment_accounts',tenantId+'_system_airtel_mobile_money')));
 await assert.rejects(submitEod({...input,reconciliation_date:'2026-11-04'},{uid,tenantId},db));
 assert.equal((await getDoc(doc(db,'finance_payment_accounts',tenantId+'_'+bank))).data().balanceUGX,400);
 console.log('Automatic branch EOD posting, replay, assignment, tampering and atomic failure PASSED');
}finally{await env.cleanup();}
