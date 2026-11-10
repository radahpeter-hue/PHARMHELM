export type CreditSourceRecord = {id:string;[key:string]:unknown};
export interface PortfolioReceivable {
 id:string;reference:string;client:string;branchId:string;businessDate:string;
 originalUGX:number;outstandingUGX:number;status:string;
}
export interface ReceivableRepayment {
 id:string;receivableId:string;reference:string;businessDate:string;amountUGX:number;
}
function money(value:unknown, recordId:string, field:string):number {
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw Error(`Invalid UGX amount in ${field} on credit record ${recordId}.`);
 return value;
}
export function receivableDate(value:unknown):string {
 const raw=value as {toDate?:()=>Date}|null;
 const date=typeof raw?.toDate==='function'?raw.toDate().toISOString():typeof value==='string'?value:'';
 return /^\d{4}-\d{2}-\d{2}/.test(date)?date.slice(0,10):'';
}
/** Saved credit obligations only. Invoices and POS evidence are never added a second time. */
export function projectCreditReceivables(tenantId:string,records:readonly CreditSourceRecord[],payments:readonly CreditSourceRecord[]=[]) {
 const ids=new Set<string>(),receipts=new Set<string>();
 const rows:PortfolioReceivable[]=records.map(raw=>{
  if(!raw.id||raw.tenantId!==tenantId||ids.has(raw.id))throw Error('Duplicate or out-of-tenant receivable.');
  ids.add(raw.id);
  const receipt=String(raw.receipt_id||raw.saleId||'');
  if(receipt&&receipts.has(receipt))throw Error('Multiple saved receivables reference the same sale. Reconcile duplicates before using this portfolio balance.');
  if(receipt)receipts.add(receipt);
  const originalUGX=money(raw.amount_ugx,raw.id,'amount_ugx');
  const status=String(raw.status||'outstanding').toLowerCase();
  const outstandingUGX=money(raw.outstanding_ugx??(status==='paid'?0:originalUGX),raw.id,'outstanding_ugx');
  if(outstandingUGX>originalUGX)throw Error('Receivable outstanding exceeds its original credit amount.');
  if(status==='paid'&&outstandingUGX!==0)throw Error('Paid receivable has a nonzero outstanding balance.');
  return {id:raw.id,reference:String(raw.invoice_number||receipt||raw.id),client:String(raw.client_name||raw.institution_name||'Unspecified customer'),
   branchId:String(raw.branch_id||raw.branchId||''),businessDate:receivableDate(raw.created_at||raw.createdAt),originalUGX,outstandingUGX,status};
 });
 const paymentIds=new Set<string>();
 const repayments:ReceivableRepayment[]=payments.filter(p=>p.receivableId&&ids.has(String(p.receivableId))).map(p=>{
  if(p.tenantId!==tenantId||paymentIds.has(p.id)||p.fromPortfolio!=='receivables')throw Error('Invalid receivable repayment record.');
  paymentIds.add(p.id);
  return {id:p.id,receivableId:String(p.receivableId),reference:String(p.reference_number||p.id),businessDate:receivableDate(p.processedAt||p.createdAt),amountUGX:money(p.amount,p.id,'amount')};
 });
 const totalOutstandingUGX=rows.reduce((sum,r)=>sum+r.outstandingUGX,0);
 if(!Number.isSafeInteger(totalOutstandingUGX))throw Error('Receivables balance overflow.');
 return {rows,repayments,totalOutstandingUGX};
}
