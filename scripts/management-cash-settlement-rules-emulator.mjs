/** Authenticated isolated integration tests. Never connects to live Firebase. */
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, updateDoc, writeBatch } from 'firebase/firestore';
import { build } from 'esbuild';
if(!process.env.FIRESTORE_EMULATOR_HOST)throw new Error('FIRESTORE_EMULATOR_HOST is required.');
mkdirSync('node_modules/.cache/finance-emulator',{recursive:true});
await build({entryPoints:['src/services/cashGrnSettlementService.ts','src/services/managementCashPosting.ts','src/services/managementPaymentAccountService.ts'],outdir:'node_modules/.cache/finance-emulator',bundle:true,platform:'node',format:'esm',packages:'external',plugins:[{name:'isolated-firebase',setup(b){b.onResolve({filter:/\/firebase$/},()=>({path:'firebase',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const db={};export const auth={currentUser:null};',loader:'js'}));}}]});
const {settleCashGrnDraft}=await import('../node_modules/.cache/finance-emulator/cashGrnSettlementService.js');
const {postManagementCashEntry,createManagementFinanceWriteGroup,postManagementReceivablePayment,stageManagementCashEntry}=await import('../node_modules/.cache/finance-emulator/managementCashPosting.js');
const {registerManagementPaymentAccount}=await import('../node_modules/.cache/finance-emulator/managementPaymentAccountService.js');
const tenantId='finance-test',financeUid='finance-secondary';
const env=await initializeTestEnvironment({projectId:'pharmhelm-finance-settlement-rules',firestore:{rules:readFileSync(process.env.PHARMHELM_TEST_RULES || 'firestore.rules','utf8')}});
const actor=uid=>env.authenticatedContext(uid).firestore();
const finance=actor(financeUid);
const accountId=kind=>`${tenantId}_management_${kind==='bank'?'bank':'petty_cash'}`;
const accountName=kind=>`management_${kind==='bank'?'bank':'petty_cash'}`;
const refs=key=>({grnId:`grn_${key}`,invoiceId:`invoice_${key}`,draftId:`management_payment_draft_grn_${key}`,legacyId:`procurement_register_${key}`});
const admin=async fn=>{let result;await env.withSecurityRulesDisabled(async ctx=>{result=await fn(ctx.firestore());});return result;};
async function seed(key,kind='petty_cash',balance=50000,operational=false){
 await admin(async db=>{
  await setDoc(doc(db,'finance_payment_accounts',accountId(kind)),{tenantId,accountId:accountName(kind),name:'Test funding account',kind,currency:'UGX',initialized:true,balanceUGX:balance,openingBalanceUGX:balance,lastPostingId:null,controlVersion:1});
  const r=refs(key);
  if(operational)await setDoc(doc(db,'stock_orders',`order_${key}`),{tenantId,inventoryClass:'OPERATIONAL',category:'non_sellable'});
  await setDoc(doc(db,'grn_records',r.grnId),{tenantId,inventoryClass:operational?'OPERATIONAL':'SELLABLE',...(operational?{order_id:`order_${key}`}:{ }),invoice_id:r.invoiceId,procurement_invoice_id:r.legacyId,payment_type:'cash',payment_status:'pending_payment',status:'completed',grn_status:'completed'});
  const invoice={tenantId,grnId:r.grnId,paymentType:'cash',invoiceValue:38000,paidAmountUGX:0,paid_amount_ugx:0,paymentStatus:'Pending Payment',creditBalance:38000};
  await setDoc(doc(db,'invoices',r.invoiceId),invoice);await setDoc(doc(db,'procurement_invoices',r.legacyId),invoice);
  await setDoc(doc(db,'management_expenses',r.draftId),{tenantId,source:'procurement_cash_grn',excludeFromOpexRollup:true,grnId:r.grnId,invoiceId:r.invoiceId,amount:38000,status:'draft',paidAmountUGX:0});
 });
}
const input=(key,requestId,amountUGX=38000,kind='petty_cash')=>({tenantId,draftId:refs(key).draftId,requestId,amountUGX,externalReference:`TEST-VOUCHER-${requestId}`,paymentAccountId:accountName(kind),actor:{uid:financeUid,name:'Test Finance'}});
const value=async(c,id)=>admin(async db=>(await getDoc(doc(db,c,id))).data());
const count=async c=>admin(async db=>(await getDocs(collection(db,c))).size);
try {
 await admin(async db=>{
  await setDoc(doc(db,'system_settings',tenantId),{tenantId,managementCashAccountControlV1:true,managementCashSettlementV1:true});
  for(const [uid,role,secondaryRoles,t] of [[financeUid,'IT Head',['Finance Officer'],tenantId],['finance-primary','Finance Head',[],tenantId],['procurement-only','IT Head',['Procurement Personnel'],tenantId],['logistics','Logistics Head',[],tenantId],['hr','HR Head',[],tenantId],['foreign-finance','Finance Head',[],'other']]) await setDoc(doc(db,'staff',uid),{tenantId:t,role,secondaryRoles,active:true,status:'active',assigned_branches:['HQ']});
 });
 // First-time reconciliation is separate from settlement and preserves historical entries.
 await admin(db=>setDoc(doc(db,'petty_cash_ledger','historical-opening'),{tenantId,type:'incoming',amount:50000}));
 await assertSucceeds(registerManagementPaymentAccount({tenantId,actorId:financeUid,kind:'petty_cash',name:'Test Cash',reconciliationReference:'Verified cash count'},finance));
 assert.equal((await value('finance_payment_accounts',accountId('petty_cash'))).balanceUGX,50000);
 await assert.rejects(registerManagementPaymentAccount({tenantId,actorId:financeUid,kind:'petty_cash',name:'Replace balance',reconciliationReference:'Rejected replacement'},finance));
 console.log('PASS registered opening reconciliation; no balance replacement.');
 await seed('full');
 const full=await assertSucceeds(settleCashGrnDraft(input('full','full-payment'),finance));
 assert.equal(full.remainingUGX,0);assert.equal((await value('invoices',refs('full').invoiceId)).paidAmountUGX,38000);
 assert.equal((await value('finance_payment_accounts',accountId('petty_cash'))).balanceUGX,12000);
 const beforeDuplicate=await count('petty_cash_ledger');
 const replay=await assertSucceeds(settleCashGrnDraft(input('full','full-payment'),finance));
 assert.equal(replay.alreadyProcessed,true);assert.equal(await count('petty_cash_ledger'),beforeDuplicate);
 await assert.rejects(settleCashGrnDraft(input('full','full-payment',100),finance));
 console.log('PASS full payment, idempotent retry, conflicting retry rejected.');
 await seed('partial');
 await assertSucceeds(settleCashGrnDraft(input('partial','first-installment',10000),finance));
 assert.equal((await value('invoices',refs('partial').invoiceId)).creditBalance,28000);
 assert.equal((await value('management_expenses',refs('partial').draftId)).status,'partial');
 await assertSucceeds(settleCashGrnDraft(input('partial','second-installment',28000),finance));
 assert.equal((await value('invoices',refs('partial').invoiceId)).paidAmountUGX,38000);
 console.log('PASS partial installments reconcile canonical and procurement invoice balances.');
 await seed('insufficient','petty_cash',1000);
 const beforeInsufficient=await count('cash_grn_payments');
 await assert.rejects(settleCashGrnDraft(input('insufficient','not-funded'),finance),/Insufficient/);
 assert.equal(await count('cash_grn_payments'),beforeInsufficient);
 assert.equal((await value('management_expenses',refs('insufficient').draftId)).status,'draft');
 console.log('PASS insufficient funds leaves every financial record untouched.');
 await seed('bank','bank');
 await assertSucceeds(settleCashGrnDraft(input('bank','bank-payment',38000,'bank'),finance));
 assert.equal((await value('finance_payment_accounts',accountId('bank'))).balanceUGX,12000);
 console.log('PASS registered Bank account posts its banking ledger and settles invoice.');
 await seed('operational','petty_cash',50000,true);
 await assertSucceeds(settleCashGrnDraft(input('operational','operational-payment'),finance));
 assert.equal((await value('grn_records',refs('operational').grnId)).payment_status,'paid');
 assert.equal(await count('operational_finance_events'),0);
 console.log('PASS Operational GRN payment without duplicate OPEX or stock movement.');
 await seed('double');
 const double=await Promise.all([settleCashGrnDraft(input('double','same-click'),finance),settleCashGrnDraft(input('double','same-click'),finance)]);
 assert.equal(double.filter(x=>!x.alreadyProcessed).length,1);
 assert.equal((await value('finance_payment_accounts',accountId('petty_cash'))).balanceUGX,12000);
 console.log('PASS simultaneous double-click creates one payment.');
 await seed('concurrent-a');await seed('concurrent-b');
 const concurrent=await Promise.allSettled([settleCashGrnDraft(input('concurrent-a','race-a'),finance),settleCashGrnDraft(input('concurrent-b','race-b'),finance)]);
 assert.equal(concurrent.filter(x=>x.status==='fulfilled').length,1);
 assert.equal((await value('finance_payment_accounts',accountId('petty_cash'))).balanceUGX,12000);
 console.log('PASS concurrent invoices cannot overdraw the shared account.');
 await seed('competing-writer');
 const group=createManagementFinanceWriteGroup(tenantId,'logistics',actor('logistics'));
 const expense=group.add('fuel_logs',{tenantId,cost_ugx:30000});
 group.add('petty_cash_ledger',{tenantId,amount:30000,type:'outgoing',source:'Fuel expense'});
 const race=await Promise.allSettled([settleCashGrnDraft(input('competing-writer','supplier-race'),finance),group.commit()]);
 assert.equal(race.filter(x=>x.status==='fulfilled').length,1);
 const afterRace=await value('finance_payment_accounts',accountId('petty_cash'));
 assert.ok([12000,20000].includes(afterRace.balanceUGX));
 assert.equal(Boolean(await value('fuel_logs',expense.id)),race[1].status==='fulfilled');
 console.log('PASS competing Logistics posting is atomic and cannot bypass balance control.');
 await seed('bank-race','bank');
 await admin(db=>setDoc(doc(db,'finance_payment_accounts',accountId('petty_cash')),{tenantId,accountId:accountName('petty_cash'),name:'Cash',kind:'petty_cash',currency:'UGX',initialized:true,balanceUGX:0,openingBalanceUGX:0,lastPostingId:null,controlVersion:1}));
 const transfer=createManagementFinanceWriteGroup(tenantId,financeUid,finance);
 const transferRef=transfer.add('cashTransfers',{tenantId,fromPortfolio:'banked',toPortfolio:'petty_cash',amount:20000});
 const bankRace=await Promise.allSettled([settleCashGrnDraft(input('bank-race','bank-supplier',38000,'bank'),finance),transfer.commit()]);
 assert.equal(bankRace.filter(x=>x.status==='fulfilled').length,1);
 const didTransfer=bankRace[1].status==='fulfilled';
 assert.equal(Boolean(await value('cashTransfers',transferRef.id)),didTransfer);
 assert.equal((await value('finance_payment_accounts',accountId('petty_cash'))).balanceUGX,didTransfer?20000:0);
 console.log('PASS bank transfer and supplier settlement share the same bank balance.');
 await seed('receivable-source','bank',0);
 await admin(db=>setDoc(doc(db,'credit_receivables','receivable'),{tenantId,branch_id:'HQ',outstanding_ugx:10000,amount_ugx:10000,status:'outstanding'}));
 const receivableInput={tenantId,receivableId:'receivable',amountUGX:10000,requestId:'receivable-request',actorId:financeUid};
 await Promise.all([postManagementReceivablePayment(receivableInput,finance),postManagementReceivablePayment(receivableInput,finance)]);
 assert.equal((await value('finance_payment_accounts',accountId('bank'))).balanceUGX,10000);
 assert.equal((await value('credit_receivables','receivable')).outstanding_ugx,0);
 console.log('PASS receivable-to-bank funding is atomic and duplicate-safe.');
 // Knowing a debt ID must not bypass branch authority through a raw valid bank batch.
 await admin(db=>setDoc(doc(db,'credit_receivables','other-branch-debt'),{tenantId,branch_id:'MASAKA',outstanding_ugx:1000,amount_ugx:1000,status:'outstanding'}));
 const unauthorizedBranch=writeBatch(finance);
 const unauthorizedTransfer=doc(finance,'cashTransfers','unauthorized-branch-transfer');
 const unauthorizedMovement=`transfer_${unauthorizedTransfer.id}`;
 stageManagementCashEntry(unauthorizedBranch,unauthorizedMovement,{tenantId,type:'incoming',amount:1000,source:'Credit receivable payment',transferId:unauthorizedTransfer.id},finance,'management_bank',financeUid);
 unauthorizedBranch.set(unauthorizedTransfer,{tenantId,fromPortfolio:'receivables',toPortfolio:'banked',amount:1000,receivableId:'other-branch-debt',bankMovementId:unauthorizedMovement,processedBy:financeUid});
 unauthorizedBranch.update(doc(finance,'credit_receivables','other-branch-debt'),{outstanding_ugx:0,status:'paid',lastProcessedAt:new Date(),lastReceiptMovementId:unauthorizedMovement});
 await assertFails(unauthorizedBranch.commit());
 assert.equal((await value('finance_payment_accounts',accountId('bank'))).balanceUGX,10000);
 assert.equal((await value('credit_receivables','other-branch-debt')).outstanding_ugx,1000);
 assert.equal(await value('cashTransfers',unauthorizedTransfer.id),undefined);
 console.log('PASS raw cross-branch legacy collection rolls back bank, debt and movement together.');
 await admin(async db=>{
   await setDoc(doc(db,'credit_receivables','inactive-finance-debt'),{tenantId,branch_id:'HQ',outstanding_ugx:1000,amount_ugx:1000,status:'outstanding'});
   await updateDoc(doc(db,'staff',financeUid),{active:false,status:'inactive'});
 });
 await assertFails(postManagementReceivablePayment({tenantId,receivableId:'inactive-finance-debt',amountUGX:1000,requestId:'inactive-finance',actorId:financeUid},finance));
 assert.equal((await value('finance_payment_accounts',accountId('bank'))).balanceUGX,10000);
 assert.equal((await value('credit_receivables','inactive-finance-debt')).outstanding_ugx,1000);
 await admin(db=>updateDoc(doc(db,'staff',financeUid),{active:true,status:'active'}));
 console.log('PASS inactive Finance cannot read or collect legacy debt despite a valid role and branch.');



 await assertFails(updateDoc(doc(actor('foreign-finance'),'credit_receivables','receivable'),{outstanding_ugx:999999}));
 await assertFails(updateDoc(doc(finance,'credit_receivables','receivable'),{tenantId:'other'}));
 await seed('denied');
 await assertFails(settleCashGrnDraft({...input('denied','wrong-role'),actor:{uid:'procurement-only',name:'Procurement'}},actor('procurement-only')));
 await assertFails(settleCashGrnDraft({...input('denied','foreign'),actor:{uid:'foreign-finance',name:'Other Finance'}},actor('foreign-finance')));
 await assertFails(setDoc(doc(finance,'petty_cash_ledger','unlinked-write'),{tenantId,amount:1,type:'outgoing'}));
 await assertFails(updateDoc(doc(finance,'finance_payment_accounts',accountId('petty_cash')),{balanceUGX:999999}));
 await assertFails(updateDoc(doc(finance,'invoices',refs('denied').invoiceId),{paidAmountUGX:38000,paymentStatus:'Paid'}));
 await assertFails(updateDoc(doc(finance,'petty_cash_ledger','historical-opening'),{amount:999999}));
 await assertFails(postManagementCashEntry({tenantId,amount:60000,type:'outgoing'},finance,'overdraw',financeUid));
 console.log('PASS role and tenant isolation, immutable ledgers, unlinked account edits and unfunded batches denied.');
 // Compact helpers retain the exact custom-role view/functional boundary.
 await admin(async db=>{
  for(const [uid,role,level,module] of [['custom-view','Finance Viewer','view_only','finance'],['custom-cash','Cash Operator','view_functional','hr'],['custom-foreign','Foreign Cash','all','finance']]){
   await setDoc(doc(db,'staff',uid),{tenantId,role,roleRealmId:uid,status:'active',active:true});
   await setDoc(doc(db,'role_realms_of_operation',uid),{tenantId:uid==='custom-foreign'?'other':tenantId,roleName:role,roleType:'custom',permissions:{[module]:{accessLevel:level}}});
  }
 });
 await assertSucceeds(getDoc(doc(actor('custom-view'),'finance_payment_accounts',accountId('petty_cash'))));
 await assertFails(postManagementCashEntry({tenantId,amount:1,type:'outgoing'},actor('custom-view'),'view-cannot-post','custom-view'));
 await assertSucceeds(postManagementCashEntry({tenantId,amount:1,type:'outgoing'},actor('custom-cash'),'custom-cash-post','custom-cash'));
 await assertFails(postManagementCashEntry({tenantId,amount:1,type:'outgoing'},actor('custom-foreign'),'foreign-realm-cannot-post','custom-foreign'));
 console.log('PASS compact Finance view and custom cash access preserve functional and tenant boundaries.');
 await admin(db=>updateDoc(doc(db,'system_settings',tenantId),{managementCashSettlementV1:false,managementCashAccountControlV1:false}));
 await seed('unreleased');
 await assert.rejects(settleCashGrnDraft(input('unreleased','release-gate'),finance),/release activation/);
 console.log('PASS settlement stays disabled until explicit Finance release activation.');
 console.log('Management Cash/Bank settlement authenticated emulator acceptance passed.');
} finally {await env.cleanup();}
