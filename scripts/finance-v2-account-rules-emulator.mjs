/** Isolated authenticated Finance V2 account gate tests. Never contacts production. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,updateDoc,runTransaction,serverTimestamp} from 'firebase/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Firestore emulator required');
const env=await initializeTestEnvironment({projectId:'pharmhelm-finance-v2-rules',firestore:{rules:readFileSync('firestore.rules','utf8')}});
const admin=async fn=>{let result;await env.withSecurityRulesDisabled(async ctx=>{result=await fn(ctx.firestore());});return result;};
const user=uid=>env.authenticatedContext(uid).firestore();
const tenant='finance-v2-tenant',branch='branch-a';
const payload={tenantId:tenant,accountId:'cash_a',name:'Branch Cash',kind:'BRANCH_CASH_SALES',branchId:branch,
  currency:'UGX',balanceUGX:0,openingBalanceUGX:0,reconciliationReference:'COUNT-2026-001',initialized:true,
  controlVersion:2,active:true,registeredBy:'finance-a',lastPostingId:null,createdAt:new Date(),updatedAt:new Date()};
const account=(db,id='cash_a')=>doc(db,'finance_payment_accounts',tenant+'_'+id);
try {
  await admin(async db=>{
    await setDoc(doc(db,'branches',branch),{tenantId:tenant,name:'Test branch'});
    await setDoc(doc(db,'branches','other-branch'),{tenantId:tenant,name:'Other branch'});
    await setDoc(doc(db,'system_settings',tenant),{tenantId:tenant,financeV2AccountRegistrationEnabled:false});
    for(const [id,t,branches] of [['finance-a',tenant,[branch]],['finance-b','another-tenant',[branch]],['finance-c',tenant,[]]]) {
      await setDoc(doc(db,'staff',id),{tenantId:t,role:'Finance Head',secondaryRoles:[],assigned_branches:branches,status:'active',active:true});
    }
  });
  const finance=user('finance-a');
  await assertFails(setDoc(doc(finance,'finance_v2_pos_cash_sources','forged'),{tenantId:tenant,cashUGX:500}));
  await assertFails(updateDoc(doc(finance,'system_settings',tenant),{financeV2PosCashFundingEnabled:true}));
  await assertSucceeds(updateDoc(doc(finance,'system_settings',tenant),{ordinaryFinancePreference:'preserved'}));
  await assertFails(setDoc(account(finance),payload));
  console.log('PASS default disabled gate blocks registration');
  await admin(db=>setDoc(doc(db,'system_settings',tenant),{tenantId:tenant,financeV2AccountRegistrationEnabled:true}));
  await assertSucceeds(setDoc(account(finance),{...payload,createdAt:serverTimestamp(),updatedAt:serverTimestamp()}));
  await assertSucceeds(getDoc(account(finance)));
  await assertFails(getDoc(account(user('finance-b'))));
  console.log('PASS gated Finance Head can register and read own-tenant V2 account; cross-tenant read blocked');
  await assertFails(setDoc(account(finance,'cash_duplicate'),{...payload,accountId:'cash_duplicate',createdAt:serverTimestamp(),updatedAt:new Date()}));
  await assertFails(setDoc(account(finance,'cash_extra'),{...payload,accountId:'cash_extra',extraField:1,createdAt:serverTimestamp(),updatedAt:serverTimestamp()}));
  await assertFails(setDoc(account(finance,'cash_positive'),{...payload,accountId:'cash_positive',balanceUGX:500,openingBalanceUGX:500}));
  await assertFails(setDoc(account(finance,'cash_wrong_actor'),{...payload,accountId:'cash_wrong_actor',registeredBy:'another'}));
  await assertFails(setDoc(account(user('finance-b'),'cash_foreign'),{...payload,accountId:'cash_foreign',registeredBy:'finance-b'}));
  await assertFails(setDoc(account(user('finance-c'),'cash_otherbranch'),{...payload,accountId:'cash_otherbranch',branchId:'other-branch',registeredBy:'finance-c'}));
  await assertFails(updateDoc(account(finance),{balanceUGX:999999}));
  await assertFails(setDoc(doc(finance,'finance_v2_transfers','transfer_1'),{tenantId:tenant,amountUGX:100}));
  await assertFails(setDoc(doc(finance,'finance_v2_events','event_1'),{tenantId:tenant,amountUGX:100}));
  await assertFails(setDoc(doc(finance,'finance_v2_account_movements','movement_1'),{tenantId:tenant,deltaUGX:100}));
  // Even a complete, mathematically balanced client transaction must fail until
  // the dedicated cross-document transfer rules are certified.
  await admin(db=>updateDoc(account(db),{balanceUGX:500}));
  await admin(db=>setDoc(account(db,'cash_b'),{...payload,accountId:'cash_b',balanceUGX:0,openingBalanceUGX:0}));
  await assertFails(runTransaction(finance,async tx=>{
    const source=account(finance);
    const target=account(finance,'cash_b');
    const [beforeSource,beforeTarget]=await Promise.all([tx.get(source),tx.get(target)]);
    assert.equal(beforeSource.data().balanceUGX,500);
    assert.equal(beforeTarget.data().balanceUGX,0);
    tx.set(doc(finance,'finance_v2_transfers','finance_v2_transfer_'+tenant+'_proof'),{
      tenantId:tenant,requestId:'proof',sourceAccountId:'cash_a',destinationAccountId:'cash_b',
      chargePayerAccountId:'cash_a',principalUGX:100,chargeUGX:0,actorUid:'finance-a',status:'posted'
    });
    tx.update(source,{balanceUGX:400,lastPostingId:'finance_v2_transfer_'+tenant+'_proof'});
    tx.update(target,{balanceUGX:100,lastPostingId:'finance_v2_transfer_'+tenant+'_proof'});
    tx.set(doc(finance,'finance_v2_account_movements','proof_0'),{tenantId:tenant,accountId:'cash_a',deltaUGX:-100});
    tx.set(doc(finance,'finance_v2_account_movements','proof_1'),{tenantId:tenant,accountId:'cash_b',deltaUGX:100});
  }));
  assert.equal(await admin(async db=>(await getDoc(account(db))).data().balanceUGX),500);
  assert.equal(await admin(async db=>(await getDoc(account(db,'cash_b'))).data().balanceUGX),0);
  console.log('PASS complete but uncertified transfer transaction denied atomically with no balance movement');
  assert.equal(await admin(async db=>(await getDoc(account(db))).data().balanceUGX),500);
  console.log('PASS wrong tenant, branch, actor, opening, direct balance and orphan postings denied');
} finally {await env.cleanup();}
