import {loadAuthoritativePortfolioLedger} from '../src/domain/finance/authoritativePortfolioLedger.ts';
import {registerPortfolioFunding} from '../src/domain/finance/portfolioFunding.ts';
import {defineBuiltInPortfolio} from '../src/domain/finance/builtInPortfolios.ts';
import {correctEod} from '../src/services/eodCorrectionService.ts';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,updateDoc,deleteDoc,serverTimestamp} from 'firebase/firestore';
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
  await setDoc(doc(db,'staff','owner'),{tenantId,role:'owner'});
  await setDoc(doc(db,'system_settings',tenantId),{tenantId,managementCashAccountControlV1:true});
  await setDoc(doc(db,'staff',uid),{tenantId,role:'Branch Manager',assigned_branches:[branch_id]});
  await setDoc(doc(db,'staff','it_head'),{tenantId,role:'IT Head'});
  await setDoc(doc(db,'staff','other'),{tenantId,role:'Branch Manager',assigned_branches:['other']});
  await setDoc(doc(db,'branches',branch_id),{tenantId,shifts:{dayShift:{enabled:true,startTime:'08:00',endTime:'17:00'}},cardSettlement:{bankPortfolioId:bank}});
  await setDoc(doc(db,'finance_portfolios_v1',tenantId+'__'+bank),{id:bank,tenantId,origin:'custom',status:'active',classification:'bank',scope:{kind:'organisation'},currency:'UGX',bankParentId:'system_bank',bankInstitution:'Equity',bankAccountReference:'TEST-ACCOUNT',name:'Equity test'});
 });
 const owner=env.authenticatedContext('owner',{tenantId}).firestore();
 for(const key of ['branch_cash_sales','mtn_mobile_money','airtel_mobile_money']){
  const portfolio=defineBuiltInPortfolio({tenantId,key,...(key==='branch_cash_sales'?{branchId:branch_id}:{}),createdBy:'owner',createdAt:new Date().toISOString()});
  await registerPortfolioFunding({portfolio,actorId:'owner',name:portfolio.name,openingBalanceUGX:0,reconciliationReference:'TEST-OPENING'},owner);
 }
 const bankPortfolio=(await getDoc(doc(owner,'finance_portfolios_v1',tenantId+'__'+bank))).data();
 await registerPortfolioFunding({portfolio:bankPortfolio,actorId:'owner',name:'Equity test',openingBalanceUGX:0,reconciliationReference:'BANK-OPENING'},owner);
 await assert.rejects(registerPortfolioFunding({portfolio:bankPortfolio,actorId:'owner',name:'Equity test',openingBalanceUGX:100,reconciliationReference:'DUPLICATE-OPENING'},owner));
 const db=env.authenticatedContext(uid,{tenantId}).firestore();
 const results=await Promise.all([submitEod(input,{uid,tenantId},db),submitEod(input,{uid,tenantId},db)]);
 assert.equal(results.filter(r=>!r.replayed).length,1);
 const retry=await submitEod(input,{uid,tenantId},db);assert.equal(retry.replayed,true);
 for(const [id,,amount] of targets)assert.equal((await getDoc(doc(db,'finance_payment_accounts',tenantId+'_'+id))).data().balanceUGX,amount);
 await assertFails(setDoc(doc(db,'eod_reconciliations','eod~tenant_a~masaka~2026-11-05~dayShift'),{...input,reconciliation_date:'2026-11-05',financial_posting:'portfolios_v1'}));
 await assertFails(updateDoc(doc(db,'finance_payment_accounts',tenantId+'_'+bank),{balanceUGX:999999}));
 const other=env.authenticatedContext('other',{tenantId}).firestore();
 await assert.rejects(submitEod({...input,reconciliation_date:'2026-11-03'},{uid:'other',tenantId},other));
 const zeroId='eod~tenant_a~masaka~2026-11-06~dayShift';
 const zero={...input,reconciliation_date:'2026-11-06',reconciliation_key:zeroId,financial_posting:'portfolios_v1',card_settlement_account_id:bank,cashier_id:'other'};
 for(const c of ['cash','momo','airtel','card'])zero[c+'_actual']=0;
 await assertFails(setDoc(doc(other,'eod_reconciliations',zeroId),zero));
 await setDoc(doc(db,'eod_reconciliations',zeroId),{...zero,cashier_id:uid});
 await assertFails(setDoc(doc(db,'eod_reconciliations','legacy-bypass'),{...input,financial_posting:'none',audit_only:true}));
 const it=env.authenticatedContext('it_head',{tenantId}).firestore();
 const auditId='eod~tenant_a~masaka~2026-11-02~dayShift';
 await assertFails(updateDoc(doc(it,'eod_reconciliations',auditId),{cash_actual:999,cash_variance:879,correction_reason:'unpaired',corrected_by:'it_head',corrected_at:serverTimestamp(),correction_posting_id:'unpaired'}));
 await correctEod(auditId,{uid:'it_head',tenantId,role:'IT Head'},{cash:100,momo:200,airtel:300,card:400,insurance:0,institutional_credit:0,staff_welfare:0},'Correct declared collections',it);
 for(const [index,[accountId]] of targets.entries())assert.equal((await getDoc(doc(db,'finance_payment_accounts',tenantId+'_'+accountId))).data().balanceUGX,[100,200,300,400][index]);
 const correction=(cash,momo=200,airtel=300,card=400)=>({cash,momo,airtel,card,insurance:0,institutional_credit:0,staff_welfare:0});
 await correctEod(auditId,{uid:'it_head',tenantId,role:'IT Head'},correction(100),'Retry correction without adding funds',it);
 assert.equal((await getDoc(doc(db,'finance_payment_accounts',tenantId+'_system_branch_cash_sales_masaka'))).data().balanceUGX,100);
 // Preserve the original card destination even when the branch default changes.
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'branches',branch_id),{cardSettlement:{bankPortfolioId:'bank_'+'b'.repeat(64)}}));
 await correctEod(auditId,{uid:'it_head',tenantId,role:'IT Head'},correction(110,210,310,410),'Verified additional collections',it);
 for(const [index,[accountId]] of targets.entries()){
  const snapshot=await getDoc(doc(db,'finance_payment_accounts',tenantId+'_'+accountId));
  assert.equal(snapshot.data().balanceUGX,[110,210,310,410][index]);
  const ledger=await loadAuthoritativePortfolioLedger({...snapshot.data(),id:snapshot.id},{from:'1900-01-01',to:'9999-12-31',direction:'all'},owner);
  assert.equal(ledger.currentBalanceUGX,[110,210,310,410][index]);
  assert.equal(ledger.entries.length,3,'One original funding plus two linked correction movements');
  assert.ok(ledger.entries.every(e=>e.eodReconciliationId===auditId&&e.shiftId==='dayShift'));
 }
 // A correction may not reverse funds already spent. No audit/channel changes may survive.
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'finance_payment_accounts',tenantId+'_system_branch_cash_sales_masaka'),{balanceUGX:0}));
 await assert.rejects(correctEod(auditId,{uid:'it_head',tenantId,role:'IT Head'},correction(100),'Insufficient cash reversal',it));
 assert.equal((await getDoc(doc(it,'eod_reconciliations',auditId))).data().cash_actual,110);
 assert.equal((await getDoc(doc(db,'finance_payment_accounts',tenantId+'_'+bank))).data().balanceUGX,410);
 await assert.rejects(correctEod(auditId,{uid,tenantId,role:'Branch Manager'},correction(120),'Unauthorized correction',db));
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'branches',branch_id),{cardSettlement:{bankPortfolioId:bank}}));
 await env.withSecurityRulesDisabled(c=>deleteDoc(doc(c.firestore(),'finance_payment_accounts',tenantId+'_system_airtel_mobile_money')));
 await assert.rejects(submitEod({...input,reconciliation_date:'2026-11-04'},{uid,tenantId},db));
 assert.equal((await getDoc(doc(db,'finance_payment_accounts',tenantId+'_'+bank))).data().balanceUGX,410);
 await env.withSecurityRulesDisabled(async c=>{
  assert.equal((await getDoc(doc(c.firestore(),'eod_reconciliations','eod~tenant_a~masaka~2026-11-04~dayShift'))).exists(),false,'Atomic failure cannot leave an EOD record');
  await setDoc(doc(c.firestore(),'staff','second_operator'),{tenantId,role:'Branch Manager',assigned_branches:['second_branch']});
  await setDoc(doc(c.firestore(),'staff','foreign_operator'),{tenantId:'foreign_tenant',role:'owner'});
  await setDoc(doc(c.firestore(),'branches','second_branch'),{tenantId,shifts:{dayShift:{enabled:true,startTime:'08:00',endTime:'17:00'},nightShift:{enabled:true,startTime:'17:00',endTime:'23:00'}}});
 });
 const secondPortfolio=defineBuiltInPortfolio({tenantId,key:'branch_cash_sales',branchId:'second_branch',createdBy:'owner',createdAt:new Date().toISOString()});
 await registerPortfolioFunding({portfolio:secondPortfolio,actorId:'owner',name:'Second branch cash',openingBalanceUGX:0,reconciliationReference:'SECOND-OPENING'},owner);
 const second=env.authenticatedContext('second_operator',{tenantId}).firestore();
 const secondInput={...input,branch_id:'second_branch',cash_actual:700,cash_expected:700,momo_actual:0,momo_expected:0,airtel_actual:0,airtel_expected:0,card_actual:0,card_expected:0};
 const day=await submitEod(secondInput,{uid:'second_operator',tenantId},second);
 const nightInput={...secondInput,shift_id:'nightShift',shift_start:'17:00',shift_end:'23:00',cash_actual:900,cash_expected:900};
 const night=await submitEod(nightInput,{uid:'second_operator',tenantId},second);
 assert.notEqual(day.id,night.id);assert.equal(day.replayed,false);assert.equal(night.replayed,false);
 assert.equal((await submitEod(nightInput,{uid:'second_operator',tenantId},second)).replayed,true);
 const secondSnapshot=await getDoc(doc(owner,'finance_payment_accounts',tenantId+'_system_branch_cash_sales_second_branch'));
 assert.equal(secondSnapshot.data().balanceUGX,1600);
 const secondLedger=await loadAuthoritativePortfolioLedger({...secondSnapshot.data(),id:secondSnapshot.id},{from:'1900-01-01',to:'9999-12-31',direction:'all'},owner);
 assert.equal(secondLedger.entries.length,2);assert.deepEqual(new Set(secondLedger.entries.map(e=>e.shiftId)),new Set(['dayShift','nightShift']));
 const foreign=env.authenticatedContext('foreign_operator',{tenantId:'foreign_tenant'}).firestore();
 await assert.rejects(submitEod({...secondInput,reconciliation_date:'2026-11-03'},{uid:'foreign_operator',tenantId},foreign));
 console.log('Automatic branch EOD posting, exactly-once ledgers, independent branches/shifts, previous-day posting, corrections, tenant isolation and atomic failure PASSED');
}finally{await env.cleanup();}
