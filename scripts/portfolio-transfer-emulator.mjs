import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,query,where,writeBatch,serverTimestamp,deleteDoc} from 'firebase/firestore';
import {submitPortfolioTransfer} from '../src/domain/finance/portfolioTransferService.ts';
import {definePortfolioTransfer,portfolioTransferIdentity} from '../src/domain/finance/portfolioTransfer.ts';
const env=await initializeTestEnvironment({projectId:'pharmhelm-level5-bank-transfer-test',firestore:{rules:readFileSync('firestore.rules','utf8')}});
const tenant='tenant_a',equity='bank_'+'a'.repeat(64),stanbic='bank_'+'b'.repeat(64);
const funding=(id,openingBalanceUGX)=>({id:tenant+'_'+id,tenantId:tenant,accountId:id,portfolioId:id,
 portfolioClassification:'bank',scope:{kind:'organisation'},name:id===equity?'Equity Bank':'Stanbic Bank',
 kind:'bank',currency:'UGX',initialized:true,balanceUGX:openingBalanceUGX,openingBalanceUGX,
 reconciliationReference:'TEST-BANK-OPENING',lastPostingId:null,controlVersion:1});
const registry=id=>({id,tenantId:tenant,name:id===equity?'Equity Bank':'Stanbic Bank',classification:'bank',
 description:'Controlled test bank',scope:{kind:'organisation'},currency:'UGX',origin:'custom',status:'active',
 supportsChildAccounts:false,allowsTransfersIn:false,allowsTransfersOut:false,bankParentId:'system_bank',
 bankInstitution:id===equity?'EQUITY':'STANBIC',bankAccountReference:id===equity?'1234':'4567',
 createdBy:'ceo',updatedBy:'ceo',createdAt:'2026-11-06T08:00:00Z',updatedAt:'2026-11-06T08:00:00Z'});
const account=(db,id)=>doc(db,'finance_payment_accounts',tenant+'_'+id);
const portfolio=(db,id)=>doc(db,'finance_portfolios_v1',tenant+'__'+id);
const input={tenantId:tenant,sourceAccountId:equity,destinationAccountId:stanbic,principalUGX:2000000,reference:'BANK-TEST-001',actorId:'finance'};
async function seed(){await env.withSecurityRulesDisabled(async c=>{
 const db=c.firestore();
 for(const [uid,role,t] of [['finance','Finance Head',tenant],['officer','Finance Officer',tenant],['it','IT Head',tenant],['viewer','Treasury Viewer',tenant],['outsider','Finance Head','tenant_b']])
  await setDoc(doc(db,'staff',uid),{tenantId:t,role,secondaryRoles:[],assigned_branches:['masaka']});
 await setDoc(doc(db,'role_realms_of_operation',tenant+'_treasury_viewer'),{tenantId:tenant,roleType:'custom',roleName:'Treasury Viewer',permissions:{finance:{accessLevel:'view_only'}}});
 for(const [id,balance] of [[equity,10000000],[stanbic,5000000]]){
  await setDoc(account(db,id),funding(id,balance));await setDoc(portfolio(db,id),registry(id));
 }
});}
const finance=env.authenticatedContext('finance',{tenantId:tenant}).firestore();
const second=env.authenticatedContext('finance',{tenantId:tenant}).firestore();
async function balances(a,b){assert.equal((await getDoc(account(finance,equity))).data().balanceUGX,a);assert.equal((await getDoc(account(finance,stanbic))).data().balanceUGX,b);}
async function rawTransfer(reference){
 const id=await portfolioTransferIdentity(tenant,reference);
 const endpoint=bank=>({tenantId:tenant,portfolioId:'system_bank',accountId:bank,accountDocumentId:tenant+'_'+bank,
  name:bank===equity?'Equity Bank':'Stanbic Bank',branchId:'',kind:'bank'});
 return definePortfolioTransfer({id,tenantId:tenant,source:endpoint(equity),destination:endpoint(stanbic),principalUGX:100,chargeUGX:0,
  reference,initiatedBy:'finance',initiatedAt:'2026-11-06T08:00:00Z'});
}
function rawBatch(db,r,{partial=false,foreign=false}={}){
 const batch=writeBatch(db),now=serverTimestamp();
 for(const [endpoint,sign,movement] of [[r.source,-1,r.sourceMovement],...partial?[]:[[r.destination,1,r.destinationMovement]]]){
  batch.set(doc(db,movement.collection,movement.id),{tenantId:r.tenantId,accountDocumentId:endpoint.accountDocumentId,
   portfolioTransferId:r.id,amount:r.principalUGX,accountDeltaUGX:sign*r.principalUGX,type:sign<0?'outgoing':'incoming',
   movementClass:sign<0?'transfer_out':'transfer_in',source:'Transfer',reference_number:r.reference,postedBy:'finance',createdAt:now,updatedAt:now});
  // Current balance snapshots are intentionally fixed; all attack fixtures run at 2m/13m.
  batch.update(doc(db,'finance_payment_accounts',endpoint.accountDocumentId),{balanceUGX:(sign<0?2000000:13000000)+sign*r.principalUGX,lastPostingId:movement.id,updatedAt:now});
 }
 batch.set(doc(db,'finance_transfers_v1',r.id),{...r,...foreign?{destination:{...r.destination,tenantId:'tenant_b'}}:{},postedAt:now});
 return batch;
}
try{
 await env.clearFirestore();await seed();
 const first=await submitPortfolioTransfer(input,finance);assert.equal(first.replayed,false);await balances(8000000,7000000);
 assert.equal(first.record.source.portfolioId,'system_bank');assert.equal(first.record.destination.name,'Stanbic Bank');
 const viewer=env.authenticatedContext('viewer',{tenantId:tenant}).firestore();
 assert.equal((await getDoc(doc(viewer,'finance_transfers_v1',first.record.id))).exists(),true);
 const retry=await submitPortfolioTransfer({...input,reference:' bank-test-001 '},second);assert.equal(retry.replayed,true);await balances(8000000,7000000);
 await assert.rejects(submitPortfolioTransfer({...input,principalUGX:1},finance),/different transaction/);
 const simultaneous=await Promise.all([finance,second].map(db=>submitPortfolioTransfer({...input,principalUGX:1000000,reference:'CONCURRENT-001'},db)));
 assert.equal(simultaneous.filter(x=>!x.replayed).length,1);await balances(7000000,8000000);
 const spend=await Promise.allSettled(['SPEND-001','SPEND-002'].map(reference=>submitPortfolioTransfer({...input,reference,principalUGX:5000000},finance)));
 assert.equal(spend.filter(x=>x.status==='fulfilled').length,1);await balances(2000000,13000000);
 for(const principalUGX of [0,-1,0.5,NaN,3000000])await assert.rejects(submitPortfolioTransfer({...input,reference:'INVALID-AMOUNT',principalUGX},finance));
 await assert.rejects(submitPortfolioTransfer({...input,reference:'SAME-ACCOUNT',destinationAccountId:equity},finance),/different/);
 await assert.rejects(submitPortfolioTransfer({...input,reference:'NO-GENERIC-BANK',destinationAccountId:'system_bank'},finance),/individual Bank/);
 await assert.rejects(submitPortfolioTransfer({...input,reference:'NOT-YET-CHARGED',chargeUGX:5},finance),/charges are not enabled/);
 for(const actorId of ['it','viewer','outsider']){
  const actor=env.authenticatedContext(actorId,{tenantId:actorId==='outsider'?'tenant_b':tenant}).firestore();
  await assert.rejects(submitPortfolioTransfer({...input,reference:'DENIED-'+actorId,actorId,principalUGX:100},actor));
 }
 for(const [id,label] of [[equity,'source'],[stanbic,'destination']]){
  await env.withSecurityRulesDisabled(c=>setDoc(portfolio(c.firestore(),id),{...registry(id),status:'inactive'}));
  await assert.rejects(submitPortfolioTransfer({...input,reference:'INACTIVE-'+label,principalUGX:100},finance),/active/);
  const forged=await rawTransfer('FORGED-INACTIVE-'+label);await assertFails(rawBatch(finance,forged).commit());
  await env.withSecurityRulesDisabled(c=>setDoc(portfolio(c.firestore(),id),registry(id)));
 }
 await env.withSecurityRulesDisabled(c=>setDoc(account(c.firestore(),stanbic),{...funding(stanbic,5000000),balanceUGX:13000000,currency:'USD'}));
 await assert.rejects(submitPortfolioTransfer({...input,reference:'UNSUPPORTED-FX',principalUGX:100},finance),/active, reconciled/);
 await assertFails(rawBatch(finance,await rawTransfer('FORGED-FX')).commit());
 await env.withSecurityRulesDisabled(c=>setDoc(account(c.firestore(),stanbic),{...funding(stanbic,5000000),balanceUGX:13000000}));
 await assertFails(rawBatch(finance,await rawTransfer('PARTIAL-001'),{partial:true}).commit());await balances(2000000,13000000);
 await assertFails(rawBatch(finance,await rawTransfer('FOREIGN-001'),{foreign:true}).commit());await balances(2000000,13000000);
 const orphan=await rawTransfer('ORPHAN-001');
 await assertFails(setDoc(doc(finance,'finance_transfers_v1',orphan.id),{...orphan,postedAt:serverTimestamp()}));
 await assertFails(setDoc(doc(finance,'banking_records',orphan.sourceMovement.id),{tenantId:tenant,accountDocumentId:tenant+'_'+equity,amount:100,accountDeltaUGX:-100,type:'outgoing',postedBy:'finance'}));
 await assertFails(deleteDoc(doc(finance,'finance_transfers_v1',first.record.id)));
 await assertFails(deleteDoc(doc(finance,'banking_records',first.record.sourceMovement.id)));
 // Canonical records and all linked movements are immutable.
 await assertFails(setDoc(doc(finance,'finance_transfers_v1',first.record.id),{...first.record,principalUGX:1,postedAt:serverTimestamp()}));
 const records=await getDocs(query(collection(finance,'finance_transfers_v1'),where('tenantId','==',tenant)));
 const movements=await getDocs(query(collection(finance,'banking_records'),where('tenantId','==',tenant)));
 assert.equal(records.size,3);assert.equal(movements.size,6);await balances(2000000,13000000);
 for(const [id,opening] of [[equity,10000000],[stanbic,5000000]]){
  const ledger=movements.docs.map(d=>d.data()).filter(r=>r.accountDocumentId===tenant+'_'+id);
  assert.equal(opening+ledger.reduce((sum,row)=>sum+row.accountDeltaUGX,0),(await getDoc(account(finance,id))).data().balanceUGX);
 }
 console.log('Level 5 Bank-to-Bank principal PASSED: 10m/5m -> 8m/7m; 15m conserved; exactly-once concurrent retry, competing spend, linked immutable records/ledgers, atomic failure, inactive/FX/IT/tenant denial.');
}finally{await env.cleanup();}
