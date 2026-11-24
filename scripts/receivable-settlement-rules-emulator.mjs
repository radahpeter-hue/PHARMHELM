import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { collection, doc, deleteDoc, getDoc, getDocs, increment, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run against an isolated Firestore emulator.');
mkdirSync('node_modules/.cache/finance-emulator', {recursive:true});
await build({
  entryPoints:['src/services/receivableSettlement.ts'],
  outfile:'node_modules/.cache/finance-emulator/receivableSettlement.js',
  bundle:true, platform:'node', format:'esm', packages:'external',
  plugins:[{name:'emulator-only',setup(build){
    build.onResolve({filter:/\/firebase$/},()=>({path:'firebase',namespace:'stub'}));
    build.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const db={}; export const auth={currentUser:null};'}));
  }}]
});
const { settleCreditReceivable } = await import('../node_modules/.cache/finance-emulator/receivableSettlement.js');
const env = await initializeTestEnvironment({projectId:'demo-pharmhelm-level10',
  firestore:{rules:readFileSync(process.env.PHARMHELM_SETTLEMENT_RULES || 'firestore.rules','utf8')}});
const tenantId = 'martin-test';
const cash = 'system_branch_cash_sales_masaka';
const foreignCash = 'system_branch_cash_sales_other';
const mtn = 'system_mtn_mobile_money';
const airtel = 'system_airtel_mobile_money';
const bank = 'bank_' + 'a'.repeat(64);
const otherBank = 'bank_' + 'b'.repeat(64);
const safe = 'custom_cash_safe_' + 'a'.repeat(32);
const closed = 'custom_cash_safe_' + 'b'.repeat(32);
const paymentCollection = 'finance_receivable_settlements_v1';
const payAccount = (db,key) => doc(db,'finance_payment_accounts',tenantId+'_'+key);
const finance = env.authenticatedContext('finance').firestore();
const request = (id,key,amount,extra={}) => ({tenantId,receivableId:'credit',destinationAccountId:key,
  amountUGX:amount,reference:'Ref '+id,requestId:'level10_request_000000_'+id,actorId:'finance',...extra});
const admin = async fn => { let result; await env.withSecurityRulesDisabled(async ctx => {result=await fn(ctx.firestore());}); return result; };
const get = (name,id) => admin(async db=>(await getDoc(doc(db,name,id))).data());
const balance = async id => (await get('finance_payment_accounts',tenantId+'_'+id)).balanceUGX;
const row = (amount=500000) => ({tenantId,branch_id:'masaka',receipt_id:'sale',invoice_number:'MSK-500',client_id:'client',
  client_name:'Test Customer',amount_ugx:amount,outstanding_ugx:amount,status:'outstanding'});
const account = (key,kind,classification,branchId) => ({tenantId,accountId:key,portfolioId:key,kind,
  portfolioClassification:classification,scope:branchId?{kind:'branch',branchId}:{kind:'organisation'},name:key,
  initialized:true,currency:'UGX',balanceUGX:0,openingBalanceUGX:0,lastPostingId:null});
const insertAccount = async (db,data,registry={}) => {
  await setDoc(payAccount(db,data.accountId),data);
  if (/^(custom_|bank_)/.test(data.accountId)) await setDoc(doc(db,'finance_portfolios_v1',tenantId+'__'+data.accountId),
    {tenantId,id:data.accountId,currency:'UGX',origin:'custom',status:'active',allowsTransfersIn:true,
      scope:data.scope,classification:data.portfolioClassification,...registry});
};

try {
  await env.clearFirestore();
  await admin(async db=>{
    for(const [uid,role,tenant,branches,active] of [
      ['finance','Finance Head',tenantId,[],true],['another','Finance Officer',tenantId,['masaka'],true],
      ['other-branch','Finance Officer',tenantId,['other'],true],['foreign','Finance Head','outside',[],true],
      ['inactive','Finance Head',tenantId,[],false],['cashier','Cashier',tenantId,['masaka'],true]
    ]) await setDoc(doc(db,'staff',uid),{role,tenantId:tenant,assigned_branches:branches,active,status:active?'active':'inactive'});
    for(const branch of ['masaka','other']) await setDoc(doc(db,'branches',branch),{tenantId,status:'Active'});
    await setDoc(doc(db,'credit_receivables','credit'),row());
    await setDoc(doc(db,'credit_receivables','racing'),{...row(100000),receipt_id:'race-sale'});
    await setDoc(doc(db,'credit_receivables','different'),{...row(70000),receipt_id:'different-sale'});
    await insertAccount(db,account(cash,'petty_cash','cash_equivalent','masaka'));
    await insertAccount(db,account(foreignCash,'petty_cash','cash_equivalent','other'));
    await insertAccount(db,account(mtn,'bank','mobile_money'));
    await insertAccount(db,account(airtel,'bank','mobile_money'));
    await insertAccount(db,account(bank,'bank','bank'),{bankParentId:'system_bank'});
    await insertAccount(db,account(otherBank,'bank','bank'),{bankParentId:'system_bank'});
    await insertAccount(db,account(safe,'petty_cash','cash_equivalent','masaka'));
    await insertAccount(db,account(closed,'petty_cash','cash_equivalent','masaka'),{status:'inactive'});
  });
  const cashier = env.authenticatedContext('cashier').firestore();
  assert.equal((await getDocs(query(collection(cashier,'credit_receivables'),where('tenantId','==',tenantId),where('branch_id','==','masaka')))).size,3);
  await assertFails(getDocs(query(collection(cashier,'credit_receivables'),where('tenantId','==',tenantId))));
  await assertFails(setDoc(doc(finance,'credit_receivables','fake'),row()));
  await assertFails(updateDoc(doc(finance,'credit_receivables','credit'),{outstanding_ugx:100000}));
  await assertFails(deleteDoc(doc(finance,'credit_receivables','credit')));
  await assertFails(getDoc(doc(env.authenticatedContext('foreign').firestore(),'credit_receivables','credit')));
  for(const actorId of ['other-branch','inactive','cashier','foreign']) {
    await assert.rejects(settleCreditReceivable(request(actorId,mtn,10,{actorId}),env.authenticatedContext(actorId).firestore()));
  }
  for(const key of [foreignCash,closed,'management_bank','system_bank','missing']) {
    await assert.rejects(settleCreditReceivable(request('invalid_'+key,mtn,10,{destinationAccountId:key}),finance));
  }
  console.log('PASS tenant, branch, role, active portfolio and direct receivable write controls.');

  const payment = request('first',mtn,200000);
  const first = await settleCreditReceivable(payment,finance);
  assert.equal(first.remainingUGX,300000);
  assert.equal((await get('credit_receivables','credit')).status,'partial');
  assert.equal(await balance(mtn),200000);
  assert.equal(await balance(bank),0);
  assert.equal((await settleCreditReceivable(payment,finance)).replayed,true);
  for (const patch of [{amountUGX:30000},{receivableId:'different'},{destinationAccountId:airtel},{reference:'changed'},{tenantId:'outside'}]) {
    await assert.rejects(settleCreditReceivable({...payment,...patch},finance));
  }
  await assert.rejects(settleCreditReceivable(request('over',cash,300001),finance));
  await settleCreditReceivable(request('second',bank,150000),finance);
  const final = await settleCreditReceivable(request('third',cash,150000),finance);
  assert.equal(final.remainingUGX,0);
  assert.equal((await get('credit_receivables','credit')).status,'paid');
  assert.equal(await balance(bank),150000);
  assert.equal(await balance(otherBank),0);
  assert.equal(await balance(cash),150000);
  await assert.rejects(settleCreditReceivable(request('paid',cash,1),finance));
  const saved = await get(paymentCollection,first.settlementId);
  assert.equal(saved.invoiceNumber,'MSK-500');
  assert.equal((await get('banking_records',saved.movementId)).reference_number,payment.reference);
  await assertFails(updateDoc(doc(finance,paymentCollection,saved.settlementId),{amountUGX:1}));
  await assertFails(deleteDoc(doc(finance,'banking_records',saved.movementId)));
  console.log('PASS three payments, selected bank, sales cash, history, replay and overpayment.');

  const competing = await Promise.allSettled([
    settleCreditReceivable(request('race-one',airtel,80000,{receivableId:'racing'}),finance),
    settleCreditReceivable(request('race-two',airtel,80000,{receivableId:'racing',actorId:'another'}),
      env.authenticatedContext('another').firestore())
  ]);
  assert.equal(competing.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(await balance(airtel),80000);
  assert.equal((await get('credit_receivables','racing')).outstanding_ugx,20000);
  await settleCreditReceivable(request('custom',safe,20000,{receivableId:'racing'}),finance);
  assert.equal(await balance(safe),20000);
  const scopedHistory = query(collection(cashier,paymentCollection),where('tenantId','==',tenantId),where('branchId','==','masaka'));
  assert.equal((await getDocs(scopedHistory)).size,5);

  const forged = 'receivable_payment_forged';
  const movementOnly = writeBatch(finance);
  movementOnly.set(doc(finance,'banking_records',forged),{tenantId,type:'incoming',amount:250,
    accountDeltaUGX:250,postedBy:'finance',accountDocumentId:tenantId+'_'+mtn,source:'Credit receivable payment'});
  movementOnly.update(payAccount(finance,mtn),{balanceUGX:increment(250),lastPostingId:forged});
  await assertFails(movementOnly.commit());
  const attempt = request('incomplete',mtn,2000,{receivableId:'different'});
  await assertFails(setDoc(doc(finance,paymentCollection,attempt.requestId),{
    ...saved,...attempt,settlementId:attempt.requestId,movementId:'receivable_payment_'+attempt.requestId,recordedAt:serverTimestamp()
  }));
  await assertFails(updateDoc(doc(finance,'credit_receivables','different'),{
    outstanding_ugx:68000,status:'partial',lastSettlementId:saved.settlementId,lastProcessedAt:serverTimestamp()
  }));
  assert.equal(await balance(mtn),200000);
  assert.equal((await get('credit_receivables','different')).outstanding_ugx,70000);
  await admin(db=>setDoc(doc(db,'credit_receivables','officer'),{...row(10000),receipt_id:'officer-sale'}));
  const officerPayment=await settleCreditReceivable(request('officer',safe,1000,{receivableId:'officer',actorId:'another'}),
    env.authenticatedContext('another').firestore());
  assert.equal(officerPayment.remainingUGX,9000);
  assert.equal(await balance(safe),21000);
  console.log('PASS Airtel concurrency, custom account, explicit branch Finance Officer collection, branch history and incomplete/replayed journal rejection.');
} finally {
  await env.cleanup();
}
