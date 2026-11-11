/** Authenticated isolated integration tests. Never connects to live Firebase. */
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, query, where, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { build } from 'esbuild';
if(!process.env.FIRESTORE_EMULATOR_HOST)throw new Error('FIRESTORE_EMULATOR_HOST is required.');
mkdirSync('node_modules/.cache/finance-emulator',{recursive:true});
await build({entryPoints:['src/services/cashGrnSettlementService.ts','src/services/creditGrnSettlementService.ts','src/domain/finance/cashOutflows.ts','src/domain/finance/portfolioFirestore.ts','src/domain/finance/portfolioFunding.ts','src/services/managementCashPosting.ts','src/services/managementPaymentAccountService.ts'],outdir:'node_modules/.cache/finance-emulator',entryNames:'[name]',bundle:true,platform:'node',format:'esm',packages:'external',plugins:[{name:'isolated-firebase',setup(b){b.onResolve({filter:/\/firebase$/},()=>({path:'firebase',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const db={};export const auth={currentUser:null};',loader:'js'}));}}]});
const {settleCashGrnDraft}=await import('../node_modules/.cache/finance-emulator/cashGrnSettlementService.js');
const {settleSupplierCreditDraft,requestSupplierCreditDraft,rejectSupplierCreditDraft}=await import('../node_modules/.cache/finance-emulator/creditGrnSettlementService.js');
const {collectCashOutflows}=await import('../node_modules/.cache/finance-emulator/cashOutflows.js');
const {createCustomFinancialPortfolio}=await import('../node_modules/.cache/finance-emulator/portfolioFirestore.js');
const {registerPortfolioFunding}=await import('../node_modules/.cache/finance-emulator/portfolioFunding.js');
const {postManagementCashEntry,createManagementFinanceWriteGroup,postManagementReceivablePayment}=await import('../node_modules/.cache/finance-emulator/managementCashPosting.js');
const {registerManagementPaymentAccount}=await import('../node_modules/.cache/finance-emulator/managementPaymentAccountService.js');
const tenantId='finance-test',financeUid='finance-secondary';
const env=await initializeTestEnvironment({projectId:'pharmhelm-finance-settlement-rules',firestore:{rules:readFileSync(process.env.PHARMHELM_SETTLEMENT_RULES || 'firestore.rules','utf8')}});
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
  for(const [uid,role,secondaryRoles,t] of [[financeUid,'IT Head',['Finance Officer'],tenantId],['finance-primary','Finance Head',[],tenantId],['procurement-only','IT Head',['Procurement Personnel'],tenantId],['logistics','Logistics Head',[],tenantId],['hr','HR Head',[],tenantId],['foreign-finance','Finance Head',[],'other']]) await setDoc(doc(db,'staff',uid),{tenantId:t,role,secondaryRoles,active:true,status:'active',assigned_branches:[]});
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
 await admin(db=>setDoc(doc(db,'credit_receivables','receivable'),{tenantId,outstanding_ugx:10000,amount_ugx:10000,status:'outstanding'}));
 const receivableInput={tenantId,receivableId:'receivable',amountUGX:10000,requestId:'receivable-request',actorId:financeUid};
 await Promise.all([postManagementReceivablePayment(receivableInput,finance),postManagementReceivablePayment(receivableInput,finance)]);
 assert.equal((await value('finance_payment_accounts',accountId('bank'))).balanceUGX,10000);
 assert.equal((await value('credit_receivables','receivable')).outstanding_ugx,0);
 console.log('PASS receivable-to-bank funding is atomic and duplicate-safe.');

 await assertFails(updateDoc(doc(actor('foreign-finance'),'credit_receivables','receivable'),{outstanding_ugx:999999}));
 await assertFails(updateDoc(doc(finance,'credit_receivables','receivable'),{tenantId:'other'}));
 await seed('denied');
 await assert.rejects(settleCashGrnDraft({...input('denied','wrong-role'),actor:{uid:'procurement-only',name:'Procurement'}},actor('procurement-only')), /HQ Finance/);
 await assert.rejects(settleCashGrnDraft({...input('denied','foreign'),actor:{uid:'foreign-finance',name:'Other Finance'}},actor('foreign-finance')), /HQ Finance/);
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
 // Cash and credit GRN creation use the same tenant-scoped links as the procurement writers.
 const newGrn = async (key, paymentType) => {
   const r = refs(key);
   const liabilityId = 'supplier_credit_' + key;
   const invoice = {tenantId,grnId:r.grnId,invoiceValue:38000,invoiceRef:'INV-' + key,paidAmountUGX:0,creditBalance:38000,
     paymentType,paymentStatus:paymentType==='cash'?'Pending Payment':'Outstanding'};
   const operator = actor('procurement-only');
   const batch = writeBatch(operator);
   batch.set(doc(operator,'grn_records',r.grnId),{tenantId,inventoryClass:'SELLABLE',status:'completed',
     invoice_id:r.invoiceId,procurement_invoice_id:r.legacyId,credit_ledger_id:paymentType==='credit'?liabilityId:null,
     payment_type:paymentType,payment_status:paymentType==='cash'?'pending_payment':'outstanding'});
   batch.set(doc(operator,'invoices',r.invoiceId),invoice);
   batch.set(doc(operator,'procurement_invoices',r.legacyId),{...invoice,paid_amount_ugx:0,status:'Unpaid'});
   if (paymentType==='credit') {
     batch.set(doc(operator,'creditLedger',liabilityId),{tenantId,grnId:r.grnId,invoiceId:r.invoiceId,
       originalCreditAmount:38000,remainingCreditBalance:38000,amount:38000,balance:38000,
       status:'outstanding',paymentHistoryIds:[]});
   } else {
     batch.set(doc(operator,'management_expenses',r.draftId),{tenantId,grnId:r.grnId,invoiceId:r.invoiceId,
       amount:38000,amount_ugx:38000,paidAmountUGX:0,source:'procurement_cash_grn',excludeFromOpexRollup:true,
       status:'draft',paymentStatus:'pending_payment',createdBy:'procurement-only'});
   }
   await assertSucceeds(batch.commit());
   return {...r, liabilityId};
 };
 const cashBeforeGrns = await count('petty_cash_ledger');
 const bankBeforeGrns = await count('banking_records');
 await newGrn('level8-cash','cash');
 const credit = await newGrn('level8-credit','credit');
 assert.equal(await count('petty_cash_ledger'),cashBeforeGrns);
 assert.equal(await count('banking_records'),bankBeforeGrns);
 assert.equal((await value('creditLedger',credit.liabilityId)).balance,38000);
 const branchId = 'masaka';
 const cashSales = 'system_branch_cash_sales_' + branchId;
 const mobile = 'system_mtn_mobile_money';
 const airtel = 'system_airtel_mobile_money';
 const registeredBank = 'bank_' + 'a'.repeat(64);
 const cashSafe = 'custom_cash_safe_' + 'a'.repeat(32);
 const fundingId = key => tenantId + '_' + key;
 const addFunding = async (db, key, kind, classification, scope, balance) => {
   await setDoc(doc(db,'finance_payment_accounts',fundingId(key)),{tenantId,accountId:key,portfolioId:key,
     name:key,kind,currency:'UGX',initialized:true,portfolioClassification:classification,scope,balanceUGX:balance});
 };
 await admin(async db=>{
   await setDoc(doc(db,'branches',branchId),{tenantId,name:'Masaka',status:'Active'});
   await setDoc(doc(db,'staff','branch-manager'),{tenantId,role:'Branch Manager',secondaryRoles:['Finance Officer'],
     status:'active',assigned_branches:[branchId]});
   await setDoc(doc(db,'staff','inactive-finance'),{tenantId,role:'Finance Head',status:'inactive',active:true});
   const hq = {kind:'organisation'};
   const masaka = {kind:'branch',branchId};
   await addFunding(db,cashSales,'petty_cash','cash_equivalent',masaka,20000);
   await addFunding(db,mobile,'bank','mobile_money',hq,20000);
   await addFunding(db,airtel,'bank','mobile_money',hq,15000);
   await addFunding(db,registeredBank,'bank','bank',hq,25000);
   await setDoc(doc(db,'staff','treasury-owner'),{tenantId,role:'owner',status:'active'});
   await setDoc(doc(db,'finance_portfolios_v1',tenantId+'__'+registeredBank),{tenantId,id:registeredBank,status:'active',
     origin:'custom',classification:'bank',scope:hq,currency:'UGX',bankParentId:'system_bank'});
 });
 const owner = actor('treasury-owner');
 const cashSafeRegistration = {tenantId,id:cashSafe,status:'active',origin:'custom',name:'Masaka Cash Safe',
   classification:'cash_equivalent',scope:{kind:'branch',branchId},currency:'UGX',description:'Branch cash safe',
   supportsChildAccounts:false,allowsTransfersIn:true,allowsTransfersOut:true,createdAt:new Date().toISOString()};
 await assertFails(createCustomFinancialPortfolio({...cashSafeRegistration,createdBy:financeUid},finance));
 const safe = await assertSucceeds(createCustomFinancialPortfolio({...cashSafeRegistration,createdBy:'treasury-owner'},owner));
 await assertSucceeds(registerPortfolioFunding({portfolio:safe,actorId:'treasury-owner',name:safe.name,
   openingBalanceUGX:20000,reconciliationReference:'Masaka safe opening count'},owner));
 const visible = await assertSucceeds(getDocs(query(collection(finance,'finance_portfolios_v1'),where('tenantId','==',tenantId))));
 assert.ok(visible.docs.some(row=>row.id===tenantId+'__'+cashSafe));
 const hqActor = {uid:financeUid,name:'Test Finance'};
 const fundCash = (key,requestId,amountUGX,paymentAccountId,chargeUGX=0) =>
   ({...input(key,requestId,amountUGX),paymentAccountId,chargeUGX});
 const cashPart = await assertSucceeds(settleCashGrnDraft(fundCash('level8-cash','cash-branch',10000,cashSales,1000),finance));
 assert.equal(cashPart.remainingUGX,28000);
 assert.equal((await value('finance_payment_accounts',fundingId(cashSales))).balanceUGX,9000);
 const cashPosted = await value('cash_grn_payments',cashPart.paymentId);
 assert.equal(cashPosted.fundingBranchName,'Masaka');
 assert.equal(cashPosted.totalDebitUGX,11000);
 assert.equal((await value('petty_cash_ledger',cashPart.paymentId+'_fee')).expenseCategory,'Financial service expenses');
 const ledgerSize = await count('banking_records');
 await assert.rejects(settleCashGrnDraft(fundCash('level8-cash','mtn-insufficient',20000,mobile,1),finance),/Insufficient/);
 assert.equal(await count('banking_records'),ledgerSize);
 assert.equal((await value('invoices',refs('level8-cash').invoiceId)).creditBalance,28000);
 const mobilePart = await assertSucceeds(settleCashGrnDraft(fundCash('level8-cash','cash-mtn',18000,mobile,500),finance));
 assert.equal((await value('finance_payment_accounts',fundingId(mobile))).balanceUGX,1500);
 const airtelPart = await assertSucceeds(settleCashGrnDraft(fundCash('level8-cash','cash-airtel',10000,airtel),finance));
 assert.equal(airtelPart.remainingUGX,0);
 assert.equal(await value('banking_records',airtelPart.paymentId+'_fee'),undefined);
 assert.equal((await value('invoices',refs('level8-cash').invoiceId)).paidAmountUGX,38000);
 console.log('PASS cash GRN with three portfolios, separate charges, exact debit and atomic insufficient-funds rejection.');

 const approval = {tenantId,creditLedgerId:credit.liabilityId,amountUGX:38000,requestId:'level8-approval',actor:hqActor};
 const creditDraft = await assertSucceeds(requestSupplierCreditDraft(approval,finance));
 assert.equal(await requestSupplierCreditDraft(approval,finance),creditDraft);
 await assert.rejects(requestSupplierCreditDraft({...approval,requestId:'second-approval'},finance),/already has/);
 const creditInput = (requestId,amountUGX,paymentAccountId,chargeUGX=0) =>
   ({tenantId,draftId:creditDraft,requestId,externalReference:'CREDIT-'+requestId,amountUGX,paymentAccountId,chargeUGX,actor:hqActor});
 const request = creditInput('credit-bank',20000,registeredBank,2500);
 const creditRace = await Promise.all([settleSupplierCreditDraft(request,finance),settleSupplierCreditDraft(request,finance)]);
 assert.equal(creditRace.filter(result=>!result.alreadyProcessed).length,1);
 const creditPart = creditRace[0];
 const postedCredit = await value('creditPayments',creditPart.paymentId);
 assert.equal(postedCredit.invoiceId,credit.invoiceId);
 assert.equal(postedCredit.creditLedgerId,credit.liabilityId);
 assert.equal(postedCredit.grnId,credit.grnId);
 assert.equal(postedCredit.balanceAfter,18000);
 assert.equal(postedCredit.totalDebitUGX,22500);
 assert.equal((await value('finance_payment_accounts',fundingId(registeredBank))).balanceUGX,2500);
 assert.equal((await value('creditLedger',credit.liabilityId)).remainingCreditBalance,18000);
 assert.equal((await value('creditLedger',credit.liabilityId)).status,'processing');
 await assert.rejects(settleSupplierCreditDraft({...request,chargeUGX:2501},finance),/different payment/);
 await assert.rejects(settleSupplierCreditDraft(creditInput('overpay',18001,cashSafe),finance),/approved draft|outstanding/);
 const attempts = await Promise.allSettled([
   settleSupplierCreditDraft(creditInput('credit-safe-a',18000,cashSafe,1000),finance),
   settleSupplierCreditDraft(creditInput('credit-safe-b',18000,cashSafe,1000),finance),
 ]);
 assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);
 const last = attempts.find(result=>result.status==='fulfilled').value;
 assert.equal(last.remainingUGX,0);
 assert.equal((await value('finance_payment_accounts',fundingId(cashSafe))).balanceUGX,1000);
 assert.equal((await value('invoices',credit.invoiceId)).paidAmountUGX,38000);
 assert.equal((await value('procurement_invoices',credit.legacyId)).creditBalance,0);
 assert.equal((await value('grn_records',credit.grnId)).payment_status,'paid');
 assert.deepEqual((await value('creditLedger',credit.liabilityId)).paymentHistoryIds,[creditPart.paymentId,last.paymentId]);
 console.log('PASS credit approval, multi-account installment settlement, concurrent retries, GRN references and liability history.');

 const rejected = await newGrn('level8-rejected','credit');
 const rejection = {...approval,creditLedgerId:rejected.liabilityId,requestId:'reject-draft'};
 const rejectedDraft = await requestSupplierCreditDraft(rejection,finance);
 await assertSucceeds(rejectSupplierCreditDraft({tenantId,draftId:rejectedDraft,actor:hqActor},finance));
 assert.equal((await value('management_expenses',rejectedDraft)).status,'rejected');
 assert.equal((await value('creditLedger',rejected.liabilityId)).status,'outstanding');
 await assertSucceeds(requestSupplierCreditDraft({...rejection,requestId:'replacement-draft'},finance));
 assert.equal((await value('creditLedger',rejected.liabilityId)).remainingCreditBalance,38000);
 console.log('PASS credit draft rejection releases the unchanged liability for approval.');

 // One provider reference can never be replayed through a later approval for
 // the same invoice. The first draft is fully used while the liability remains.
 const multiDraft = await newGrn('level8-two-approvals','credit');
 const firstDraft = await requestSupplierCreditDraft({...approval,creditLedgerId:multiDraft.liabilityId,
   amountUGX:500,requestId:'approval-a'},finance);
 const firstVoucher = {tenantId,draftId:firstDraft,requestId:'one-invoice-one-voucher',amountUGX:500,
   externalReference:'DUPLICATE-VOUCHER',paymentAccountId:mobile,actor:hqActor};
 await assertSucceeds(settleSupplierCreditDraft(firstVoucher,finance));
 const secondDraft = await requestSupplierCreditDraft({...approval,creditLedgerId:multiDraft.liabilityId,
   amountUGX:500,requestId:'approval-b'},finance);
 await assert.rejects(settleSupplierCreditDraft({...firstVoucher,draftId:secondDraft},finance),/different payment/);
 assert.equal((await value('creditLedger',multiDraft.liabilityId)).remainingCreditBalance,37500);
 assert.equal((await value('finance_payment_accounts',fundingId(mobile))).balanceUGX,1000);
 console.log('PASS credit payment identity prevents a second debit when a voucher is reused across approvals.');

 const directPayment = {...postedCredit,processedAt:serverTimestamp(),processedBy:'branch-manager'};
 const branchDb = actor('branch-manager');
 await assert.rejects(settleSupplierCreditDraft({...request,actor:{uid:'branch-manager',name:'Branch Manager'}},branchDb),/HQ Finance/);
 await assert.rejects(settleCashGrnDraft({...fundCash('denied','inactive',1,cashSales),actor:{uid:'inactive-finance',name:'Inactive'}},actor('inactive-finance')),/HQ Finance/);
 await assertFails(setDoc(doc(branchDb,'creditPayments','branch-fabricated-payment'),directPayment));
 await assertFails(updateDoc(doc(branchDb,'creditLedger',rejected.liabilityId),{remainingCreditBalance:0,status:'paid'}));
 await assertFails(updateDoc(doc(branchDb,'invoices',rejected.invoiceId),{creditBalance:0,paymentStatus:'paid'}));
 await assertFails(updateDoc(doc(branchDb,'grn_records',rejected.grnId),{payment_status:'paid'}));
 await assertFails(setDoc(doc(finance,'creditPayments','supplier_credit_settlement_missing_fake'),{
   ...postedCredit,draftId:'missing',requestId:'fake',processedAt:serverTimestamp(),
 }));
 await assertFails(setDoc(doc(finance,'petty_cash_ledger','unlinked-supplier-charge'),{
   tenantId,amount:1000,type:'outgoing',supplierCharge:true,supplierPosting:'credit',paymentId:creditPart.paymentId,
   accountDocumentId:fundingId(cashSafe),accountDeltaUGX:-1000,postedBy:financeUid,
 }));
 // Replay a complete posting directly through the SDK so denials exercise Rules,
 // including cases that bypass every service-side validation.
 const raw = await newGrn('level8-raw','cash');
 const rawRequest = 'raw-rules';
 const rawId = `procurement_cash_settlement_${tenantId}_${raw.draftId}_${rawRequest}`;
 const rawCharge = rawId + '_fee';
 const principal = await value('petty_cash_ledger',cashPart.paymentId);
 const fee = await value('petty_cash_ledger',cashPart.paymentId+'_fee');
 const rawBalance = (await value('finance_payment_accounts',fundingId(cashSales))).balanceUGX;
 const rawCommit = (connection, uid, { omitCharge = false, wrongCharge = false, wrongInvoiceBalance = false } = {}) => {
   const batch = writeBatch(connection);
   const reference = 'PAY-GRN-' + rawRequest;
   const links = {invoiceId:raw.invoiceId,grnId:raw.grnId,externalReference:'RAW-VOUCHER-123'};
   batch.set(doc(connection,'cash_grn_payments',rawId),{...cashPosted,...links,requestId:rawRequest,
     draftId:raw.draftId,procurementInvoiceId:raw.legacyId,processedBy:uid,processedAt:serverTimestamp(),
     reference,movementId:rawId,chargeMovementId:rawCharge,amountUGX:1000,chargeUGX:100,totalDebitUGX:1100,remainingUGX:37000});
   batch.set(doc(connection,'petty_cash_ledger',rawId),{...principal,...links,paymentId:rawId,
     postedBy:uid,reference_number:reference,amount:1000,accountDeltaUGX:-1000});
   if (!omitCharge) batch.set(doc(connection,'petty_cash_ledger',rawCharge),{...fee,...links,paymentId:rawId,
     postedBy:uid,reference_number:reference,amount:wrongCharge?99:100,accountDeltaUGX:wrongCharge?-99:-100});
   batch.update(doc(connection,'finance_payment_accounts',fundingId(cashSales)),{balanceUGX:rawBalance-1100,lastPostingId:rawId});
   const invoiceUpdate = {paidAmountUGX:1000,paymentStatus:'Partially Paid',creditBalance:37000,
     lastPaymentId:rawId,lastPaymentReference:links.externalReference};
   batch.update(doc(connection,'invoices',raw.invoiceId),{...invoiceUpdate,creditBalance:wrongInvoiceBalance?36900:37000});
   batch.update(doc(connection,'procurement_invoices',raw.legacyId),{...invoiceUpdate,paid_amount_ugx:1000,status:'Partial'});
   batch.update(doc(connection,'grn_records',raw.grnId),{payment_status:'partial',lastPaymentId:rawId});
   batch.update(doc(connection,'management_expenses',raw.draftId),{status:'partial',paymentStatus:'partial',
     paidAmountUGX:1000,balanceUGX:37000,lastPaymentId:rawId});
   return batch.commit();
 };
 await assertFails(rawCommit(finance,financeUid,{omitCharge:true}));
 await assertFails(rawCommit(finance,financeUid,{wrongCharge:true}));
 await assertFails(rawCommit(finance,financeUid,{wrongInvoiceBalance:true}));
 await assertFails(rawCommit(branchDb,'branch-manager'));
 assert.equal((await value('finance_payment_accounts',fundingId(cashSales))).balanceUGX,rawBalance);
 assert.equal(await value('cash_grn_payments',rawId),undefined);
 await assertSucceeds(rawCommit(finance,financeUid));
 assert.equal((await value('finance_payment_accounts',fundingId(cashSales))).balanceUGX,rawBalance-1100);
 console.log('PASS Rules independently require the exact charge, liability update and HQ authority in a complete atomic batch.');

 await admin(db=>updateDoc(doc(db,'finance_portfolios_v1',tenantId+'__'+cashSafe),{status:'inactive'}));
 await assert.rejects(settleCashGrnDraft(fundCash('denied','inactive-funding',1,cashSafe),finance),/eligible/);
 await admin(db=>updateDoc(doc(db,'branches',branchId),{status:'Closed'}));
 await assert.rejects(settleCashGrnDraft(fundCash('denied','closed-branch',1,cashSales),finance),/active branch/);
 console.log('PASS raw Rules deny fabricated payments, unlinked charges and direct liability mutations; service rejects branch or inactive users and accounts.');

 const readAll = name => admin(async db=>(await getDocs(collection(db,name))).docs.map(row=>({id:row.id,...row.data()})));
 const [accounts, cashPayments, creditPayments, petty, bank] = await Promise.all(
   ['finance_payment_accounts','cash_grn_payments','creditPayments','petty_cash_ledger','banking_records'].map(readAll));
 const outflows = collectCashOutflows({tenantId,accounts,supplierPayments:cashPayments,creditPayments,
   movements:[...petty.map(row=>({...row,collection:'petty_cash_ledger'})),...bank.map(row=>({...row,collection:'banking_records'}))]});
 const paymentIds = new Set([cashPart.paymentId,mobilePart.paymentId,airtelPart.paymentId,creditPart.paymentId,last.paymentId]);
 const level8 = outflows.filter(row=>paymentIds.has(row.sourceId));
 assert.equal(level8.length,9);
 assert.ok(level8.every(row=>row.status==='posted'));
 assert.equal(level8.filter(row=>row.category==='Financial service expenses').reduce((sum,row)=>sum+row.amount,0),5000);
 assert.equal(level8.filter(row=>row.category!=='Financial service expenses').reduce((sum,row)=>sum+row.amount,0),76000);
 assert.equal(level8.filter(row=>row.branchId===branchId).length,4);
 console.log('PASS Global Cash Outflows shows five supplier payments and four fees with no double counting.');

 await admin(db=>updateDoc(doc(db,'system_settings',tenantId),{managementCashSettlementV1:false,managementCashAccountControlV1:false}));
 await seed('unreleased');
 await assert.rejects(settleCashGrnDraft(input('unreleased','release-gate'),finance),/release activation/);
 console.log('PASS settlement stays disabled until explicit Finance release activation.');
 console.log('Management Cash/Bank settlement authenticated emulator acceptance passed.');
} finally {await env.cleanup();}
