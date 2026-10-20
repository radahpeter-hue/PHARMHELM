/** Isolated authenticated Finance V2 account gate tests. Never contacts production. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,updateDoc} from 'firebase/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Firestore emulator required');
const env=await initializeTestEnvironment({projectId:'pharmhelm-finance-v2-rules',firestore:{rules:readFileSync('firestore.rules','utf8')}});
const admin=fn=>env.withSecurityRulesDisabled(async ctx=>fn(ctx.firestore()));
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
  await assertFails(setDoc(account(finance),payload));
  console.log('PASS default disabled gate blocks registration');
  await admin(db=>setDoc(doc(db,'system_settings',tenant),{tenantId:tenant,financeV2AccountRegistrationEnabled:true}));
  await assertSucceeds(setDoc(account(finance),payload));
  console.log('PASS authorised zero opening branch account');
  await assertFails(setDoc(account(finance,'cash_positive'),{...payload,accountId:'cash_positive',balanceUGX:500,openingBalanceUGX:500}));
  await assertFails(setDoc(account(finance,'cash_wrong_actor'),{...payload,accountId:'cash_wrong_actor',registeredBy:'another'}));
  await assertFails(setDoc(account(user('finance-b'),'cash_foreign'),{...payload,accountId:'cash_foreign',registeredBy:'finance-b'}));
  await assertFails(setDoc(account(user('finance-c'),'cash_otherbranch'),{...payload,accountId:'cash_otherbranch',branchId:'other-branch',registeredBy:'finance-c'}));
  await assertFails(updateDoc(account(finance),{balanceUGX:999999}));
  await assertFails(setDoc(doc(finance,'finance_v2_transfers','transfer_1'),{tenantId:tenant,amountUGX:100}));
  await assertFails(setDoc(doc(finance,'finance_v2_events','event_1'),{tenantId:tenant,amountUGX:100}));
  await assertFails(setDoc(doc(finance,'finance_v2_account_movements','movement_1'),{tenantId:tenant,deltaUGX:100}));
  assert.equal((await getDoc(account(finance))).data().balanceUGX,0);
  console.log('PASS wrong tenant, branch, actor, opening, direct balance and orphan postings denied');
} finally {await env.cleanup();}
