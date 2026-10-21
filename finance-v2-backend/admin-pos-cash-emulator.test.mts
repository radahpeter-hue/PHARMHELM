import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore,Timestamp,FieldValue} from 'firebase-admin/firestore';
import {registerTreasuryAccount,readTreasury} from './treasury.ts';
import {branchCashAccountId,refreshBranchCash} from './posCashFunding.ts';
import {executeAuthenticatedFinanceV2Transfer} from './authenticatedTransfer.ts';
import {executeAuthenticatedFinanceV2Eod} from './authenticatedEod.ts';
import {buildPosCheckoutV2Payment,buildPosCheckoutV2OutboxEvent} from '../src/services/pos-v2/posCheckoutV2PaymentOutbox.ts';
import {assignSaleToEodShift} from '../src/services/financeV2EodPolicy.ts';
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Isolated emulator required');
const app=initializeApp({projectId:'finance-v2-pos-cash-isolated'}),db=getFirestore(app);
const tenantId='cash-tenant',branchId='masaka',uid='finance';
const token={verifyIdToken:async(value:string)=>{if(value!=='cash-funding-authenticated-token')throw Error('Bad token');return {uid};}} as any;
const authToken='cash-funding-authenticated-token';
const shifts=[{id:'day',name:'Day',startTime:'00:00',endTime:'23:59',enabled:true}];
let since=0;
async function sale(id:string,amount:number,method='cash',extra:Record<string,any>={},old=false){
 const timestamp=new Date(since+(old?-10000:1000)).toISOString();
 const sale={id,tenantId,branchId,receiptNumber:'R-'+id,engineVersion:2,status:'completed',timestamp,createdAt:old?Timestamp.fromMillis(since-10000):Timestamp.now(),updatedAt:Timestamp.now(),total:amount,totalAmount:amount,paymentMethod:method,canonicalPaymentId:'pay_'+id,transactionOutboxEventId:'out_'+id,...extra};
 const request={attemptId:'attempt_'+id,paymentMethod:method,...extra} as any;
 const payment=buildPosCheckoutV2Payment({request,saleId:id,paymentId:sale.canonicalPaymentId,receiptNumber:sale.receiptNumber,tenantId,branchId,operatorUid:uid,authoritativeTotal:amount});
 const event=buildPosCheckoutV2OutboxEvent({eventId:sale.transactionOutboxEventId,saleId:id,paymentId:sale.canonicalPaymentId,receiptNumber:sale.receiptNumber,tenantId,branchId});
 await db.doc('sales/'+id).set(sale);await db.doc('pos_payments/'+sale.canonicalPaymentId).set(JSON.parse(JSON.stringify(payment)));await db.doc('pos_transaction_outbox/'+sale.transactionOutboxEventId).set(event);return sale;
}
try{
 await db.doc('staff/'+uid).set({tenantId,active:true,status:'active',role:'Finance Head'});
 await db.doc('tenants/'+tenantId).set({status:'active'});
 await db.doc('branches/'+branchId).set({tenantId,shifts:{day:{name:'Day',startTime:'00:00',endTime:'23:59',enabled:true}}});
 await db.doc('system_settings/'+tenantId).set({tenantId,financeV2TrustedTransfersEnabled:true,financeV2AccountRegistrationEnabled:true,financeV2TrustedEodEnabled:true,financeV2PosCashFundingEnabled:true});
 const register=(accountId:string,kind:string,branchId?:string)=>registerTreasuryAccount(token,db,authToken,{tenantId,accountId,name:accountId,kind,branchId,openingBalanceUGX:0,reconciliationReference:'Prospective test account'});
 const registered=await register('ignored-client-id','BRANCH_CASH_SALES',branchId);assert.equal(registered.accountId,branchCashAccountId(branchId));
 await assert.rejects(register('duplicate-client-id','BRANCH_CASH_SALES',branchId),/already exists|ALREADY_EXISTS/i);
 await register('bank','BANK');
 const accountDocId=tenantId+'_'+registered.accountId,accountRef=db.doc('finance_payment_accounts/'+accountDocId);
 since=Date.parse((await accountRef.get()).data()!.posCashFundingFrom);
 await sale('historic',999999,'cash',{},true);
 await sale('historic_replacement',999999,'cash',{isRevisionReplacement:true,revisionOfSaleId:'historic',revisionLifecycle:'COMPLETED',updatedAt:FieldValue.serverTimestamp()});
 await db.doc('sales/historic').update({supersededBySaleId:'historic_replacement',revisionLifecycle:'COMPLETED',updatedAt:FieldValue.serverTimestamp()});
 const firstSale=await sale('original',1004000);
 // Unrelated branch and tenant must never fund Masaka.
 await db.doc('sales/foreign').set({...firstSale,id:'foreign',tenantId:'foreign'});
 const [a,b]=await Promise.all([refreshBranchCash(db,accountDocId,uid),refreshBranchCash(db,accountDocId,uid)]);
 assert.equal(a.balanceUGX,1004000);assert.equal(b.balanceUGX,1004000);
 assert.equal((await db.collection('finance_v2_events').where('eventKind','==','POS_CASH_LOCATION_POSTING').get()).size,1);
 const shift=assignSaleToEodShift(firstSale.timestamp,shifts as any)!;
 const eodRequest={tenantId,branchId,businessDate:shift.businessDate,shiftId:'day',declared:{cash:2003999,mtn:0,airtel:0,card:0,insurance:0,institutional_credit:0,staff_welfare:0},varianceReason:''};
 // Historical replacement legitimately appears in EOD but is excluded from the new cash account's opening period.
 await executeAuthenticatedFinanceV2Eod(token,db,authToken,eodRequest);
 assert.equal((await accountRef.get()).data()!.balanceUGX,1004000);
 const transfer={tenantId,actorUid:uid,requestId:'bank-once',sourceAccountId:registered.accountId,destinationAccountId:'bank',chargePayerAccountId:registered.accountId,principalUGX:1000000,chargeUGX:4000,description:'Controlled emulator banking'};
 const results=await Promise.all([executeAuthenticatedFinanceV2Transfer(token,db,authToken,transfer,true),executeAuthenticatedFinanceV2Transfer(token,db,authToken,transfer,true)]);
 assert.equal(results.filter(r=>!r.replay).length,1);assert.equal((await accountRef.get()).data()!.balanceUGX,0);assert.equal((await db.doc('finance_payment_accounts/'+tenantId+'_bank').get()).data()!.balanceUGX,1000000);
 // A lower corrected cash receipt after banking cannot spend money already in the bank.
 await sale('replacement',600000,'cash',{isRevisionReplacement:true,revisionOfSaleId:'original',revisionLifecycle:'COMPLETED',updatedAt:FieldValue.serverTimestamp()});
 await db.doc('sales/original').update({supersededBySaleId:'replacement',revisionLifecycle:'COMPLETED',revisionLocked:true,updatedAt:FieldValue.serverTimestamp()});
 await assert.rejects(executeAuthenticatedFinanceV2Transfer(token,db,authToken,{...transfer,requestId:'must-block',principalUGX:1,chargeUGX:0},true),/correction exceeds/);
 assert.equal((await accountRef.get()).data()!.balanceUGX,0);
 const blocked=await readTreasury(token,db,authToken,tenantId);assert.equal(blocked.accounts.find((a:any)=>a.accountId===registered.accountId)!.balanceAvailable,false);
 // An authorised bank-to-cash transfer can fund the pending refund. It does
 // not spend the stale branch cash balance and does not create revenue.
 await executeAuthenticatedFinanceV2Transfer(token,db,authToken,{...transfer,requestId:'refund-funding',sourceAccountId:'bank',destinationAccountId:registered.accountId,chargePayerAccountId:'bank',principalUGX:404000,chargeUGX:0},true);
 assert.equal((await refreshBranchCash(db,accountDocId,uid)).balanceUGX,0);
 assert.equal((await db.doc('finance_payment_accounts/'+tenantId+'_bank').get()).data()!.balanceUGX,596000);
 // New verified cash posts without editing balances.
 await sale('new_cash',500000);
 const corrected=await refreshBranchCash(db,accountDocId,uid);assert.equal(corrected.balanceUGX,500000);assert.equal(corrected.posCashFundedUGX,1100000);
 await sale('split',10000,'staff_welfare',{welfareAmount:6000,secondaryPaymentMethod:'cash',secondaryAmount:4000});
 await sale('credit',30000,'institutional_credit');
 assert.equal((await refreshBranchCash(db,accountDocId,uid )).balanceUGX,504000);
 const eventsBefore=(await db.collection('finance_v2_events').get()).size;
 await refreshBranchCash(db,accountDocId,uid);assert.equal((await db.collection('finance_v2_events').get()).size,eventsBefore);
 // Altered payment evidence cannot change funds.
 await db.doc('pos_payments/pay_split').update({amount:99999});
 await db.doc('sales/split').update({updatedAt:FieldValue.serverTimestamp()});
 await assert.rejects(refreshBranchCash(db,accountDocId,uid),/total mismatch/);
 assert.equal((await accountRef.get()).data()!.balanceUGX,504000);
 await db.doc('pos_payments/pay_split').update({amount:10000});
 // A newly committed sale is funded inside the same transaction as banking,
 // even when no view refresh or polling worker has run.
 await sale('just_created',10000);
 await executeAuthenticatedFinanceV2Transfer(token,db,authToken,{...transfer,requestId:'fresh-cash',principalUGX:1000,chargeUGX:0},true);
 assert.equal((await accountRef.get()).data()!.balanceUGX,513000);
 // Bounded cursor pages drain a backlog without truncating the money source.
 await Promise.all(Array.from({length:151},(_,i)=>sale('bulk_'+i,1000,'card')));
 await assert.rejects(executeAuthenticatedFinanceV2Transfer(token,db,authToken,{...transfer,requestId:'backlog',principalUGX:1,chargeUGX:0},true),/backlog/);
 assert.equal((await refreshBranchCash(db,accountDocId,uid)).balanceUGX,513000);
 await db.doc('system_settings/'+tenantId).update({financeV2PosCashFundingEnabled:false});
 await assert.rejects(executeAuthenticatedFinanceV2Transfer(token,db,authToken,{...transfer,requestId:'gate',principalUGX:1,chargeUGX:0},true),/disabled/);
 for(const doc of (await db.collection('finance_v2_events').where('eventKind','==','POS_CASH_LOCATION_POSTING').get()).docs){assert.equal(doc.data().recognizesRevenue,false);assert.equal(doc.data().recognizesExpense,false);}
 console.log('PASS prospective POS cash funding, historical exclusion, revisions, split cash, EOD no banking, full principal, separate fees, concurrent retries, refund funding guard, malformed payment and tenant activation');
}finally{await deleteApp(app);}
