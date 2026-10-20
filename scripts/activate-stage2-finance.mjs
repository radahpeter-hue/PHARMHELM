// One-time, explicitly authorized release setup. Never posts payments or ledger entries.
import assert from 'node:assert/strict';
import {initializeApp,applicationDefault,deleteApp} from 'firebase-admin/app';
import {getFirestore,Timestamp} from 'firebase-admin/firestore';
const tenantId='zehqTDcKyrDAOHKK3stJ',invoiceNumber='AVN161026001234';
const release='f3c83a12c9761b1d35ef7881ba810b6c0dc1c9e2';
const expectedBalance=3733650,expectedEntries=22;
assert.equal(process.env.STAGE2_SETUP_AUTHORIZATION,'MARTIN_PHARMA_ACCOUNT_SETUP_ONLY');
assert.equal(process.env.GITHUB_REF,'refs/heads/ops/stage2-finance-activation');
assert.ok(process.env.GITHUB_ACTOR);
assert.ok(!process.env.FIRESTORE_EMULATOR_HOST);
// Refuse setup while Hosting is stale, even if deployment has started.
const html=await fetch('https://mp.pharmhelm.com/?stage2-release='+release,{cache:'no-store'}).then(r=>{assert.ok(r.ok);return r.text();});
const asset=html.match(/<script[^>]*src="([^"]+\.js)"/);
assert.ok(asset,'Production JavaScript bundle must be identifiable.');
const bundle=await fetch(new URL(asset[1],'https://mp.pharmhelm.com'),{cache:'no-store'}).then(r=>{assert.ok(r.ok);return r.text();});
assert.ok(bundle.includes(release),'Exact Finance release must already be live.');
const app=initializeApp({credential:applicationDefault(),projectId:'gen-lang-client-0911422817'},'stage2-authorized-account-setup');
const db=getFirestore(app,'ai-studio-f7d8654b-e089-425a-a506-38159afe1e75');
try {
 const result=await db.runTransaction(async tx=>{
  const accountRef=db.collection('finance_payment_accounts').doc(tenantId+'_management_petty_cash');
  const settingsRef=db.collection('system_settings').doc(tenantId);
  const [account,settings,ledger,invoices,payments]=await Promise.all([
   tx.get(accountRef),tx.get(settingsRef),
   tx.get(db.collection('petty_cash_ledger').where('tenantId','==',tenantId)),
   tx.get(db.collection('invoices').where('tenantId','==',tenantId).where('supplierInvoiceNumber','==',invoiceNumber)),
   tx.get(db.collection('cash_grn_payments').where('tenantId','==',tenantId))
  ]);
  assert.ok(settings.exists);assert.equal(settings.get('tenantId'),tenantId);
  assert.equal(invoices.size,1,'Exactly one canonical invoice is required.');
  assert.equal(payments.size,0,'Setup must precede any supplier settlement.');
  const invoice=invoices.docs[0];
  assert.equal(invoice.get('invoiceValue'),38000);assert.equal(Number(invoice.get('paidAmountUGX')||0),0);
  assert.equal(invoice.get('paymentType'),'cash');
  const grnId=invoice.get('grnId');assert.ok(grnId);
  const [grn,draft]=await Promise.all([
   tx.get(db.collection('grn_records').doc(grnId)),
   tx.get(db.collection('management_expenses').doc('management_payment_draft_'+grnId))
  ]);
  assert.equal(grn.get('tenantId'),tenantId);assert.equal(grn.get('invoice_id'),invoice.id);
  assert.equal(draft.get('tenantId'),tenantId);assert.equal(draft.get('invoiceId'),invoice.id);
  assert.equal(draft.get('source'),'procurement_cash_grn');assert.equal(draft.get('status'),'draft');
  assert.equal(draft.get('excludeFromOpexRollup'),true);assert.equal(Number(draft.get('amount')),38000);
  let balance=0;
  for(const row of ledger.docs){
   const data=row.data(),amount=Number(data.amount),kind=String(data.type).toLowerCase();
   assert.ok(Number.isSafeInteger(amount)&&amount>=0,'Invalid historical cash amount.');
   assert.ok(['incoming','deposit','topup','outgoing','withdrawal'].includes(kind),'Unknown historical cash type.');
   balance+=['incoming','deposit','topup'].includes(kind)?amount:-amount;
  }
  assert.equal(ledger.size,expectedEntries,'Cash history changed; fresh reconciliation is required.');
  assert.equal(balance,expectedBalance,'Cash balance changed; fresh reconciliation is required.');
  const now=Timestamp.now(),runUrl=`https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  if(account.exists){
   const data=account.data();
   assert.equal(data.tenantId,tenantId);assert.equal(data.accountId,'management_petty_cash');
   assert.equal(data.kind,'petty_cash');assert.equal(data.currency,'UGX');assert.equal(data.controlVersion,1);
   assert.equal(data.initialized,true);assert.equal(data.balanceUGX,balance);
   assert.equal(data.openingBalanceUGX,expectedBalance);assert.equal(data.openingEntryCount,expectedEntries);
  }else{
   tx.create(accountRef,{tenantId,accountId:'management_petty_cash',name:'Management Petty Cash',kind:'petty_cash',currency:'UGX',initialized:true,balanceUGX:balance,openingBalanceUGX:balance,openingEntryCount:ledger.size,reconciliationReference:'Stage 2 authorized opening reconciliation: existing 22-entry ledger, UGX 3,733,650; release '+release,registeredBy:'authorized-release:'+process.env.GITHUB_ACTOR,registeredAt:now,updatedAt:now,lastPostingId:null,controlVersion:1,activationRelease:release,activationRunUrl:runUrl});
  }
  tx.update(settingsRef,{managementCashAccountControlV1:true,managementCashSettlementV1:true,managementFinanceActivation:{release,runUrl,authorizedOperator:process.env.GITHUB_ACTOR,activatedAt:now,scope:'Martin Pharma petty-cash opening and settlement activation only; no payment'}});
  return {accountCreated:!account.exists,openingBalanceUGX:balance,openingEntries:ledger.size,invoicePaidUGX:0,invoiceOutstandingUGX:38000};
 });
 // Read back only bounded records; there are deliberately no ledger/payment writes above.
 const account=await db.collection('finance_payment_accounts').doc(tenantId+'_management_petty_cash').get();
 const settings=await db.collection('system_settings').doc(tenantId).get();
 assert.equal(account.get('balanceUGX'),expectedBalance);
 assert.equal(settings.get('managementCashSettlementV1'),true);
 console.log(JSON.stringify({mode:'AUTHORIZED_ACCOUNT_SETUP_ONLY',release,...result,settlementEnabled:true,supplierPaymentsPosted:0,bankAccountsCreated:0,ledgerEntriesWritten:0}));
} finally {await deleteApp(app);}
