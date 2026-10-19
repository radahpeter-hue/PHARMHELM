/** READ-ONLY Stage 2 supplier invoice and cash ledger reconciliation.
 * No account details, supplier identities, staff details, or raw document IDs
 * are logged or written. Does not modify production Firestore.
 */
import { writeFileSync } from 'node:fs';
const projectId = 'gen-lang-client-0911422817';
const databaseId = 'ai-studio-f7d8654b-e089-425a-a506-38159afe1e75';
const tenantId = 'zehqTDcKyrDAOHKK3stJ';
const invoiceNumber = 'AVN161026001234';
const file = process.argv[2] || '/tmp/pharmhelm-stage2-finance-audit.json';
const report = {mode:'READ_ONLY',invoiceNumber,found:false,invoiceCount:0,paymentStatus:null,
  paymentType:null,expectedInvoiceUGX:null,alreadyPaidUGX:null,remainingUGX:null,
  linkedGrnFound:false,linkedDraftFound:false,cashLedgerBalanceSufficient:null,
  cashLedgerEntries:0,cashLedgerAnomalies:0,issues:[]};
if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Named live Firestore required for Stage 2 audit.');
const {initializeApp, applicationDefault, deleteApp} = await import('firebase-admin/app');
const {getFirestore} = await import('firebase-admin/firestore');
const app = initializeApp({credential:applicationDefault(),projectId},'stage2-finance-readonly');
try {
  const db = getFirestore(app,databaseId);
  const docs = await db.collection('invoices').where('supplierInvoiceNumber','==',invoiceNumber).get();
  const invoices=docs.docs.filter(x=>x.get('tenantId')===tenantId);
  report.invoiceCount=invoices.length;
  if(invoices.length!==1) report.issues.push(invoices.length?'DUPLICATE_SUPPLIER_INVOICE':'INVOICE_NOT_FOUND');
  else{
    const inv=invoices[0], x=inv.data();
    report.found=true;
    report.paymentStatus=x.paymentStatus||null;
    report.paymentType=x.paymentType||null;
    report.expectedInvoiceUGX=Number(x.invoiceValue??0);
    report.alreadyPaidUGX=Number(x.paidAmountUGX??0);
    report.remainingUGX=report.expectedInvoiceUGX-report.alreadyPaidUGX;
    if(!Number.isSafeInteger(report.expectedInvoiceUGX)||report.expectedInvoiceUGX<0||
      !Number.isSafeInteger(report.alreadyPaidUGX)||report.alreadyPaidUGX<0||
      report.remainingUGX<0)report.issues.push('INVALID_INVOICE_AMOUNTS');
    const grnId=x.grnId;
    if(grnId){
      const grn=await db.collection('grn_records').doc(grnId).get();
      report.linkedGrnFound=grn.exists&&grn.get('tenantId')===tenantId&&grn.get('invoice_id')===inv.id;
      const draft=await db.collection('management_expenses').doc('management_payment_draft_'+grnId).get();
      report.linkedDraftFound=draft.exists&&draft.get('tenantId')===tenantId&&draft.get('invoiceId')===inv.id;
    }
    if(!report.linkedGrnFound)report.issues.push('MISSING_CANONICAL_GRN_LINK');
    if(!report.linkedDraftFound)report.issues.push('MISSING_CASH_DRAFT_LINK');
    const ledger=await db.collection('petty_cash_ledger').where('tenantId','==',tenantId).get();
    let balance=0;
    report.cashLedgerEntries=ledger.size;
    for(const line of ledger.docs){
      const d=line.data(), amount=Number(d.amount??0);
      if(!Number.isSafeInteger(amount)||amount<0){report.cashLedgerAnomalies++;continue;}
      const t=String(d.type||'').toLowerCase();
      balance+=['incoming','deposit','topup'].includes(t)?amount:-amount;
    }
    report.cashLedgerBalanceSufficient=report.cashLedgerAnomalies===0&&balance>=report.remainingUGX;
    if(report.cashLedgerAnomalies) report.issues.push('CASH_LEDGER_AMOUNT_ANOMALIES');
  }
}finally{
  await deleteApp(app);
  writeFileSync(file,JSON.stringify(report,null,2));
}
console.log(JSON.stringify(report,null,2));
