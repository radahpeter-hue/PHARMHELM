/** Cash-location accounting only. Sales revenue remains owned by POS. */
export interface PosCashSource {saleId:string;paymentId:string;cashUGX:number}
export function wholeUgx(value:unknown):number {
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new Error('Cash funding requires non-negative whole UGX');
 return value;
}
export function canonicalPosCash(sale:Record<string,any>,payment:Record<string,any>,outbox:Record<string,any>):number {
 if(sale.engineVersion!==2||payment.engineVersion!==2||outbox.engineVersion!==2||outbox.eventType!=='POS_SALE_COMMITTED')throw new Error('Canonical POS V2 records required');
 for(const key of ['tenantId','branchId','receiptNumber'])if(!sale[key]||sale[key]!==payment[key]||sale[key]!==outbox[key])throw new Error('POS cash linkage mismatch');
 if(sale.id!==payment.saleId||sale.id!==outbox.saleId||sale.canonicalPaymentId!==payment.paymentId||outbox.paymentId!==payment.paymentId||sale.transactionOutboxEventId!==outbox.eventId)throw new Error('POS cash identities do not match');
 const normalize=(m:string)=>({momo:'mtn_momo',mtn:'mtn_momo',airtel:'airtel_money',credit:'institutional_credit'}[m]||m);
 if(normalize(payment.paymentMethod)!==normalize(sale.paymentMethod))throw new Error('POS payment method mismatch');
 const total=wholeUgx(sale.totalAmount??sale.total);
 if(total!==wholeUgx(payment.amount)||payment.currency!=='UGX'||!Array.isArray(payment.components)||payment.components.length<1||payment.components.length>2)throw new Error('POS cash payment total mismatch');
 if(sale.secondaryPaymentMethod){
  if(sale.paymentMethod!=='staff_welfare'||payment.components.length!==2||!payment.components.some((c:any)=>normalize(c.method)===normalize(sale.secondaryPaymentMethod)&&c.amount===wholeUgx(sale.secondaryAmount))||!payment.components.some((c:any)=>c.method==='staff_welfare'&&c.amount===wholeUgx(sale.welfareAmount)))throw new Error('POS split method or amount mismatch');
 }else if(payment.components.length!==1||normalize(payment.components[0].method)!==normalize(sale.paymentMethod))throw new Error('POS payment components do not match sale');
 let amount=0,settled=0,outstanding=0,cash=0;const methods=new Set<string>();
 const permitted=new Set(['cash','mtn_momo','momo','mtn','airtel_money','airtel','card','insurance','institutional_credit','credit','staff_welfare']);
 for(const c of payment.components){
  if(!permitted.has(c.method)||methods.has(c.method))throw new Error('Invalid POS payment components');methods.add(c.method);
  const value=wholeUgx(c.amount),paid=wholeUgx(c.settledAmount),owed=wholeUgx(c.outstandingAmount);
  if(paid+owed!==value)throw new Error('POS payment component does not reconcile');
  if(c.method==='cash'&&(paid!==value||owed!==0||c.status!=='settled'))throw new Error('Cash is not settled');
  amount+=value;settled+=paid;outstanding+=owed;if(c.method==='cash')cash+=paid;
 }
 if(amount!==total||settled!==wholeUgx(payment.settledAmount)||outstanding!==wholeUgx(payment.outstandingAmount)||![amount,settled,outstanding].every(Number.isSafeInteger))throw new Error('POS payment components do not reconcile');
 return cash;
}
export function planPosCashDelta(balanceUGX:number,previousCashUGX:number,sources:readonly PosCashSource[]){
 wholeUgx(balanceUGX);wholeUgx(previousCashUGX);
 const ids=new Set<string>();let total=0;
 for(const s of sources){if(ids.has(s.saleId))throw new Error('Duplicate cash sale');ids.add(s.saleId);total+=wholeUgx(s.cashUGX);if(!Number.isSafeInteger(total))throw new Error('Cash funding overflow');}
 return planPosCashBalance(balanceUGX,previousCashUGX,total);
}
export function planPosCashBalance(balanceUGX:number,previousCashUGX:number,total:number){
 wholeUgx(balanceUGX);wholeUgx(previousCashUGX);wholeUgx(total);
 const deltaUGX=total-previousCashUGX,closingUGX=balanceUGX+deltaUGX;
 if(!Number.isSafeInteger(closingUGX)||closingUGX<0)throw new Error('Cash correction exceeds funds remaining; reconcile the refund funding before banking');
 return {totalCashUGX:total,deltaUGX,closingUGX};
}
