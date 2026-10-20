// Read-only final acceptance. No Firestore set, update, create, delete or commit calls.
import assert from 'node:assert/strict';
import {initializeApp,applicationDefault,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
assert.ok(!process.env.FIRESTORE_EMULATOR_HOST);
const tenantId='zehqTDcKyrDAOHKK3stJ',invoiceNumber='AVN161026001234';
const app=initializeApp({credential:applicationDefault(),projectId:'gen-lang-client-0911422817'},'stage2-final-payment-readonly');
try{
 const db=getFirestore(app,'ai-studio-f7d8654b-e089-425a-a506-38159afe1e75');
 const invoices=await db.collection('invoices').where('tenantId','==',tenantId).where('supplierInvoiceNumber','==',invoiceNumber).get();
 assert.equal(invoices.size,1,'Exactly one canonical invoice required.');
 const invoice=invoices.docs[0],x=invoice.data(),grnId=x.grnId,draftId='management_payment_draft_'+grnId;
 const [grn,draft,legacy,payments,cash,bank,account]=await Promise.all([
  db.collection('grn_records').doc(grnId).get(),db.collection('management_expenses').doc(draftId).get(),
  db.collection('procurement_invoices').doc(grnId.startsWith('op_grn_')?'procurement_register_'+grnId:'procurement_register_'+grnId.slice(4)).get(),
  db.collection('cash_grn_payments').where('tenantId','==',tenantId).where('invoiceId','==',invoice.id).get(),
  db.collection('petty_cash_ledger').where('tenantId','==',tenantId).get(),
  db.collection('banking_records').where('tenantId','==',tenantId).where('invoiceId','==',invoice.id).get(),
  db.collection('finance_payment_accounts').doc(tenantId+'_management_petty_cash').get()
 ]);
 assert.equal(Number(x.invoiceValue),38000);assert.equal(Number(x.paidAmountUGX),38000);assert.equal(Number(x.creditBalance),0);assert.equal(x.paymentStatus,'Paid');
 assert.equal(payments.size,1,'Expected exactly one full settlement, with no duplicate payment.');
 const payment=payments.docs[0],p=payment.data();
 assert.equal(payment.id,'procurement_cash_settlement_'+tenantId+'_'+draftId+'_'+p.requestId);
 assert.equal(p.amountUGX,38000);assert.equal(p.previouslyPaidUGX,0);assert.equal(p.remainingUGX,0);assert.equal(p.totalInvoiceUGX,38000);
 assert.equal(p.draftId,draftId);assert.equal(p.grnId,grnId);assert.equal(p.invoiceId,invoice.id);
 assert.equal(p.paymentAccountId,'management_petty_cash');assert.equal(p.paymentAccountKind,'petty_cash');assert.equal(p.excludeFromOpexRollup,true);
 assert.ok(typeof p.externalReference==='string'&&p.externalReference.trim().length>=3);assert.ok(p.processedBy);assert.ok(p.processedAt);
 for(const record of [grn,draft,legacy,account]){assert.ok(record.exists);assert.equal(record.get('tenantId'),tenantId);}
 assert.equal(x.lastPaymentId,payment.id);assert.equal(x.lastPaymentReference,p.externalReference);
 assert.equal(grn.get('invoice_id'),invoice.id);assert.equal(grn.get('procurement_invoice_id'),legacy.id);assert.equal(grn.get('payment_status'),'paid');assert.equal(grn.get('lastPaymentId'),payment.id);
 assert.equal(legacy.id,p.procurementInvoiceId);assert.equal(legacy.get('grnId'),grnId);assert.equal(legacy.get('lastPaymentId'),payment.id);
 assert.equal(Number(legacy.get('paidAmountUGX')),38000);assert.equal(Number(legacy.get('paid_amount_ugx')),38000);assert.equal(Number(legacy.get('creditBalance')),0);assert.equal(legacy.get('paymentStatus'),'Paid');assert.equal(legacy.get('status'),'Paid');
 assert.equal(draft.get('invoiceId'),invoice.id);assert.equal(draft.get('grnId'),grnId);assert.equal(draft.get('lastPaymentId'),payment.id);
 assert.equal(draft.get('status'),'approved');assert.equal(draft.get('paymentStatus'),'paid');assert.equal(Number(draft.get('paidAmountUGX')),38000);assert.equal(Number(draft.get('balanceUGX')),0);assert.equal(draft.get('excludeFromOpexRollup'),true);
 const linked=cash.docs.filter(d=>d.id===payment.id||d.get('paymentId')===payment.id||d.get('invoiceId')===invoice.id);
 assert.equal(linked.length,1,'Exactly one linked cash movement required.');assert.equal(linked[0].id,payment.id);
 const movement=linked[0].data();assert.equal(movement.amount,38000);assert.equal(movement.type,'outgoing');assert.equal(movement.accountDeltaUGX,-38000);
 assert.equal(movement.accountDocumentId,account.id);assert.equal(movement.grnId,grnId);assert.equal(movement.invoiceId,invoice.id);assert.equal(movement.postedBy,p.processedBy);assert.equal(movement.externalReference,p.externalReference);
 assert.equal(bank.size,0,'Cash settlement must not also post a bank movement.');
 let ledgerBalance=0,controlledDelta=0,controlledCount=0;
 for(const row of cash.docs){const d=row.data(),amount=Number(d.amount),type=String(d.type).toLowerCase();
  assert.ok(Number.isSafeInteger(amount)&&amount>=0);assert.ok(['incoming','deposit','topup','outgoing','withdrawal'].includes(type));
  const delta=['incoming','deposit','topup'].includes(type)?amount:-amount;ledgerBalance+=delta;
  if(d.accountDocumentId===account.id){assert.equal(d.accountDeltaUGX,delta);controlledDelta+=delta;controlledCount++;}
 }
 assert.equal(account.get('initialized'),true);assert.equal(account.get('currency'),'UGX');assert.equal(account.get('controlVersion'),1);
 assert.equal(account.get('openingBalanceUGX'),3733650);assert.equal(account.get('openingEntryCount'),22);
 assert.equal(account.get('balanceUGX'),ledgerBalance);assert.equal(account.get('balanceUGX'),account.get('openingBalanceUGX')+controlledDelta);
 assert.ok(ledgerBalance>=0);
 console.log(JSON.stringify({mode:'READ_ONLY_FINAL_PAYMENT_ACCEPTANCE',invoiceNumber,canonicalInvoiceCount:invoices.size,paymentStatus:x.paymentStatus,invoiceUGX:38000,paidUGX:38000,outstandingUGX:0,paymentCount:payments.size,linkedCashMovementCount:linked.length,linkedBankMovementCount:bank.size,referenceRecorded:true,sourceInvoiceGrnDraftAndProcurementLedgerReconciled:true,duplicatePayments:false,duplicateCashMovements:false,additionalOpexRecognized:false,registeredCashBalanceUGX:account.get('balanceUGX'),cashLedgerBalanceUGX:ledgerBalance,cashLedgerEntryCount:cash.size,controlledMovementCount:controlledCount,additionalCashPostingsSinceActivation:controlledCount-1,accepted:true},null,2));
}finally{await deleteApp(app);}
