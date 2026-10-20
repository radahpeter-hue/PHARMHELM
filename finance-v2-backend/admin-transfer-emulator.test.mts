/** Emulator-only Admin SDK transaction acceptance. Never uses production credentials. */
import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {postTrustedFinanceV2Transfer} from '../src/services/financeV2TrustedTransferCore.ts';
import {createFinanceV2AdminStore} from '../finance-v2-backend/adminStore.ts';
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('FIRESTORE_EMULATOR_HOST is mandatory');
const app=initializeApp({projectId:'finance-v2-admin-isolated'});
const db=getFirestore(app);
const store=createFinanceV2AdminStore(db);
const actor={uid:'finance-u',tenantId:'test-tenant',active:true,canPostFinance:true};
const input={tenantId:'test-tenant',requestId:'atomic-one',sourceAccountId:'bank',destinationAccountId:'cash',chargePayerAccountId:'bank',principalUGX:10000,chargeUGX:300,actorUid:'finance-u'};
const source=db.doc('finance_payment_accounts/test-tenant_bank');
const destination=db.doc('finance_payment_accounts/test-tenant_cash');
try {
 await source.create({tenantId:'test-tenant',accountId:'bank',kind:'BANK',currency:'UGX',controlVersion:2,initialized:true,active:true,balanceUGX:15000});
 await destination.create({tenantId:'test-tenant',accountId:'cash',kind:'BRANCH_CASH_SALES',currency:'UGX',controlVersion:2,initialized:true,active:true,balanceUGX:100});
 const results=await Promise.all([postTrustedFinanceV2Transfer(store,actor,input),postTrustedFinanceV2Transfer(store,actor,input)]);
 assert.equal(results.filter(r=>!r.replay).length,1);
 assert.equal((await source.get()).data().balanceUGX,4700);
 assert.equal((await destination.get()).data().balanceUGX,10100);
 const id='finance_v2_transfer_test-tenant_atomic-one';
 assert.equal((await db.doc('finance_v2_transfers/'+id).get()).data().movementCount,3);
 for(let i=0;i<3;i++)assert.equal((await db.doc('finance_v2_account_movements/'+id+'_'+i).get()).exists,true);
 assert.equal((await db.doc('finance_v2_events/'+id+'_charge').get()).data().amountUGX,300);
 await assert.rejects(postTrustedFinanceV2Transfer(store,actor,{...input,principalUGX:9999}),/Conflicting/);
 await assert.rejects(postTrustedFinanceV2Transfer(store,actor,{...input,requestId:'unfunded',principalUGX:999999}),/Insufficient funds/);
 await assert.rejects(postTrustedFinanceV2Transfer(store,{...actor,canPostFinance:false},{...input,requestId:'unauthorised'}),/Unauthorised/);
 assert.equal((await source.get()).data().balanceUGX,4700);
 console.log('PASS atomic Admin SDK emulator: one posting, idempotent simultaneous replay, conserved principal, separate charge, insufficient and unauthorised denial');
}finally{await deleteApp(app);}
