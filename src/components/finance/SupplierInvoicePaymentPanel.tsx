import React, { useEffect, useRef, useState } from 'react';
import { doc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { settleCashGrnDraft } from '../../services/cashGrnSettlementService';
import { useManagementPaymentAccounts } from './ManagementPaymentAccounts';

type Payable={invoiceRef:string;grnRef:string;supplierName:string;total:number;paid:number;remaining:number};
export function SupplierInvoicePaymentPanel({draftId,onSettled}:{draftId:string;onSettled:()=>void}) {
 const {profile,hasPermission}=useAuth();
 const {accounts,loading:accountsLoading,error:accountsError}=useManagementPaymentAccounts();
 const [payable,setPayable]=useState<Payable|null>(null),[accountId,setAccountId]=useState('');
 const [externalReference,setExternalReference]=useState('');
 const [amount,setAmount]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false);
 const busyRef=useRef(false);
 const [history,setHistory]=useState<{id:string;reference:string;externalReference:string;amountUGX:number;remainingUGX:number}[]>([]);
 const [released,setReleased]=useState(false);
 const canPay=released&&hasPermission('finance','operate');
 useEffect(()=>{
  let disposed=false;setPayable(null);setError('');setConfirm(false);
  if(!profile?.tenantId)return;
  const tenantId=profile.tenantId;
  void (async()=>{
   const settings=await getDoc(doc(db,'system_settings',tenantId));
   if(!settings.exists()||settings.data().managementCashSettlementV1!==true)throw new Error('Supplier settlement is awaiting Finance release activation.');
   if(!disposed)setReleased(true);
   const draft=await getDoc(doc(db,'management_expenses',draftId));
   if(!draft.exists()||draft.data().tenantId!==tenantId||draft.data().source!=='procurement_cash_grn')throw new Error('Linked supplier payment draft is unavailable.');
   const invoice=await getDoc(doc(db,'invoices',draft.data().invoiceId));
   if(!invoice.exists()||invoice.data().tenantId!==tenantId||invoice.data().grnId!==draft.data().grnId)throw new Error('Supplier invoice linkage requires reconciliation.');
   const paymentHistory=await getDocs(query(collection(db,'cash_grn_payments'),where('tenantId','==',tenantId),where('invoiceId','==',invoice.id)));
   if(!disposed)setHistory(paymentHistory.docs.map(d=>({id:d.id,reference:d.data().reference,externalReference:d.data().externalReference,amountUGX:Number(d.data().amountUGX),remainingUGX:Number(d.data().remainingUGX)})));
   const value=invoice.data(),total=Number(value.invoiceValue),paid=Number(value.paidAmountUGX||0),remaining=total-paid;
   if(![total,paid,remaining].every(Number.isSafeInteger)||remaining<0)throw new Error('Invoice balances require reconciliation.');
   if(!disposed){setPayable({invoiceRef:value.supplierInvoiceNumber||value.invoiceRef,grnRef:value.grnRef||draft.data().grnId,supplierName:value.supplierName||'Supplier',total,paid,remaining});setAmount(String(remaining));}
  })().catch(e=>{if(!disposed)setError(e instanceof Error?e.message:'Unable to load supplier invoice.');});
  return()=>{disposed=true;};
 },[draftId,profile?.tenantId]);
 const availableAccounts=accounts.filter(a=>a.initialized&&a.currency==='UGX'&&Number.isSafeInteger(a.balanceUGX)&&a.balanceUGX>=0);
 const account=availableAccounts.find(a=>a.accountId===accountId);
 const value=Number(amount);
 const valid=externalReference.trim().length>=3&&externalReference.trim().length<=150&&!!payable&&!!account&&Number.isSafeInteger(value)&&value>0&&value<=payable.remaining&&value<=account.balanceUGX;
 const pay=async()=>{
  if(!valid||!payable||!account||!profile?.tenantId||!canPay||busyRef.current)return;
  busyRef.current=true;setBusy(true);setError('');
  try{
   const key=`pharmhelm_supplier_payment_${profile.tenantId}_${draftId}_${accountId}_${payable.paid}_${value}_${externalReference.trim()}`;
   let requestId=sessionStorage.getItem(key);
   if(!requestId){requestId=crypto.randomUUID();sessionStorage.setItem(key,requestId);}
   await settleCashGrnDraft({tenantId:profile.tenantId,draftId,requestId,amountUGX:value,externalReference,paymentAccountId:accountId,actor:{uid:profile.uid,name:profile.fullName||profile.email||profile.uid}});
   onSettled();
  }catch(e){setError(e instanceof Error?e.message:'Payment could not be recorded. Retry uses the same payment reference.');}
  finally{busyRef.current=false;setBusy(false);}
 };
 return <section className="min-w-0 space-y-4 text-zinc-900">
  <h4 className="text-lg font-bold text-zinc-950">Supplier invoice payment</h4>
  {payable?<><dl className="grid grid-cols-1 gap-3 rounded-xl bg-zinc-50 p-3 text-sm sm:grid-cols-2">{[['Supplier',payable.supplierName],['Invoice',payable.invoiceRef],['GRN',payable.grnRef],['Invoice total',`UGX ${payable.total.toLocaleString()}`],['Already paid',`UGX ${payable.paid.toLocaleString()}`],['Outstanding',`UGX ${payable.remaining.toLocaleString()}`]].map(([label,text])=><div key={label} className="min-w-0"><dt className="font-medium text-zinc-700">{label}</dt><dd className="break-words font-bold text-zinc-950">{text}</dd></div>)}</dl>
   <label className="block text-sm font-semibold text-zinc-900">Payment account<select aria-label="Supplier payment account" disabled={busy||confirm} value={accountId} onChange={e=>setAccountId(e.target.value)} className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-zinc-400 bg-white p-2 text-zinc-900"><option value="">Select registered Cash or Bank account</option>{availableAccounts.map(a=><option key={a.id} value={a.accountId}>{a.name} · UGX {a.balanceUGX.toLocaleString()}</option>)}</select></label>
   {account&&<p className="break-words rounded-xl bg-zinc-50 p-3 text-sm text-zinc-900"><span className="block font-semibold">{account.name}</span><span className="block">Available balance: UGX {account.balanceUGX.toLocaleString()}</span></p>}
   {!accountsLoading&&!availableAccounts.length&&<p className="text-sm font-semibold text-amber-900">Register and reconcile a Management payment account first.</p>}
   <label className="block text-sm font-semibold text-zinc-900">Amount to pay (UGX)<input aria-label="Supplier payment amount" type="number" min="1" step="1" max={payable.remaining} disabled={busy||confirm} value={amount} onChange={e=>setAmount(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-zinc-400 bg-white p-2 text-zinc-900"/></label>
   <label className="block text-sm font-semibold text-zinc-900">Bank transaction / cash voucher reference<input aria-label="Supplier payment reference" minLength={3} maxLength={150} disabled={busy||confirm} value={externalReference} onChange={e=>setExternalReference(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-zinc-400 bg-white p-2 text-zinc-900"/></label>
   {account&&value>account.balanceUGX&&<p role="alert" className="text-sm font-semibold text-red-800">Insufficient account funds.</p>}
   {confirm?<div className="space-y-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3"><p className="break-words text-sm font-semibold text-emerald-950">Record UGX {value.toLocaleString()} from {account?.name} against invoice {payable.invoiceRef}. Reference: {externalReference}. Outstanding after payment: UGX {(payable.remaining-value).toLocaleString()}.</p><div className="flex flex-col gap-2 sm:flex-row"><button disabled={busy} onClick={()=>setConfirm(false)} className="min-h-11 rounded-xl border border-zinc-400 bg-white px-4 py-2 font-bold text-zinc-900">Back</button><button disabled={busy||!valid||!canPay} onClick={()=>void pay()} className="min-h-11 rounded-xl bg-emerald-800 px-4 py-3 font-bold text-white disabled:opacity-50">{busy?'Recording payment…':'Record supplier payment'}</button></div></div>:<button disabled={!valid||!canPay||accountsLoading} onClick={()=>setConfirm(true)} className="min-h-11 w-full rounded-xl bg-emerald-800 px-4 py-3 font-bold text-white disabled:opacity-50">Review supplier payment</button>}
  </>:!error&&<p className="text-sm text-zinc-700">Loading linked invoice…</p>}
  {history.length>0&&<section className="space-y-2 border-t border-zinc-200 pt-3"><h5 className="text-sm font-bold text-zinc-950">Recorded payments</h5>{history.map(payment=><div key={payment.id} className="min-w-0 rounded-xl border border-zinc-200 p-3 text-sm text-zinc-900"><p className="break-all font-semibold">{payment.reference}</p><p className="break-all">Voucher / bank reference: {payment.externalReference}</p><p>Paid UGX {payment.amountUGX.toLocaleString()} · Remaining UGX {payment.remainingUGX.toLocaleString()}</p></div>)}</section>}
  {(error||accountsError)&&<p role="alert" className="break-words text-sm font-semibold text-red-800">{error||accountsError}</p>}
 </section>;
}
