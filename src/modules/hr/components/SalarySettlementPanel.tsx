import React,{useEffect,useState} from 'react';
import {collection,doc,onSnapshot,query,where} from 'firebase/firestore';
import {db} from '../../../firebase';
import {settleSalary,registerSalaryFundingAccount,validateSalarySettlement} from '../../../services/financeV2Disbursement';
import {toast} from 'sonner';
import {getDateKeyForTimezone} from '../../../services/consumptionService';

export function SalarySettlementPanel({payroll,profile,onClose}:{payroll:any;profile:any;onClose:()=>void}) {
 const [position,setPosition]=useState<any>(null),[accounts,setAccounts]=useState<any[]>([]),[history,setHistory]=useState<any[]>([]);
 const [accountId,setAccountId]=useState(''),[amount,setAmount]=useState(''),[fee,setFee]=useState('0');
 const [reference,setReference]=useState(''),[recipient,setRecipient]=useState('');
 const [date,setDate]=useState(getDateKeyForTimezone(new Date()));
 const [requestId,setRequestId]=useState(crypto.randomUUID()),[preview,setPreview]=useState(false),[posting,setPosting]=useState(false);
 const [error,setError]=useState(''),[register,setRegister]=useState(false);
 const [newId,setNewId]=useState(''),[newName,setNewName]=useState(''),[newKind,setNewKind]=useState('BANK');
 const branchIds=[...new Set<string>([...(profile.assigned_branches||[]),profile.branch_id,profile.default_branch_id].filter(Boolean))].slice(0,30);
 const [newBranch,setNewBranch]=useState(branchIds[0]||''),[openingRef,setOpeningRef]=useState('');
 useEffect(()=>{
   const stopPosition=onSnapshot(doc(db,'payroll',payroll.id,'state','current'),s=>setPosition(s.exists()?s.data():null),()=>setError('Salary position access denied.'));
   const stopHistory=onSnapshot(query(collection(db,'payroll',payroll.id,'settlements'),where('tenantId','==',profile.tenantId),where('branchId','==',payroll.branch_id)),s=>setHistory(s.docs.map(d=>({id:d.id,...d.data()}))),()=>setError('Payment history access denied.'));
   const stopAccounts=branchIds.length ? onSnapshot(query(collection(db,'finance_payment_accounts'),where('tenantId','==',profile.tenantId),where('controlVersion','==',2),where('branchId','in',branchIds)),s=>setAccounts(s.docs.map(d=>({id:d.id,...d.data()}))),()=>setError('Funding account access requires Finance authority and branch assignment.')) : ()=>{};
   return ()=>{stopPosition();stopHistory();stopAccounts();};
 },[payroll.id,profile.tenantId,branchIds.join(',')]);
 const account=accounts.find(a=>a.accountId===accountId);
 const principal=Number(amount),charge=Number(fee),total=principal+charge;
 const input={tenantId:profile.tenantId,payrollId:payroll.id,requestId,accountId,actorUid:profile.uid,
   amountUGX:principal,chargeUGX:charge,externalReference:reference.trim().toUpperCase(),recipientReference:recipient.trim(),paymentDate:date};
 const prepare=()=>{
   try {
     validateSalarySettlement(input);
     if(!position||position.voided||principal>position.outstandingUGX||!account||account.balanceUGX<total)throw new Error('Amount exceeds salary payable or available funding.');
     setPreview(true);setError('');
   }catch(e){setError(e instanceof Error?e.message:'Invalid payment');}
 };
 const confirm=async()=>{
   setPosting(true);
   try{await settleSalary(input);toast.success('Salary settlement and funding movement posted.');setRequestId(crypto.randomUUID());setAmount('');setReference('');setPreview(false);}
   catch(e){setError(e instanceof Error?e.message:'Payment outcome unconfirmed. Retry with this same payment reference.');}
   finally{setPosting(false);}
 };
 const createAccount=async()=>{
   setPosting(true);
   try{await registerSalaryFundingAccount({tenantId:profile.tenantId,actorUid:profile.uid,accountId:newId.trim(),name:newName.trim(),kind:newKind as any,branchId:newBranch,openingBalanceUGX:0,reconciliationReference:openingRef});setRegister(false);toast.success('Zero-opening account registered.');}
   catch(e){setError(e instanceof Error?e.message:'Account registration denied.');}finally{setPosting(false);}
 };
 const field='border rounded-lg p-2 w-full text-sm bg-white';
 return <div className="fixed inset-0 z-50 bg-slate-900/50 overflow-y-auto p-3 sm:p-8"><section className="max-w-2xl mx-auto bg-white p-5 rounded-2xl space-y-4">
   <div className="flex justify-between"><h3 className="font-bold">Settle salary: {payroll.staff_name} | {payroll.period}</h3><button disabled={posting} onClick={onClose}>Close</button></div>
   <p>Outstanding: UGX {position?.outstandingUGX?.toLocaleString()??'Unverified'} | Paid: UGX {position?.paidUGX?.toLocaleString()??'Unverified'} {position?.voided?'| Accrual reversed':''}</p>
   <p className="text-xs text-slate-600">Record a verified payment reference and recipient. Salary accrual is separate from payment. Funding must be registered, active and independently initialized.</p>
   {error&&<p role="alert" className="text-rose-700">{error}</p>}
   {!preview?<div className="grid sm:grid-cols-2 gap-3">
    <label>Funding account<select className={field} value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="">Select funding account</option>{accounts.filter(a=>a.active&&a.initialized&&a.salaryEligible).map(a=><option key={a.id} value={a.accountId}>{a.name||a.accountId} ({a.kind}): UGX {a.balanceUGX.toLocaleString()}</option>)}</select></label>
    <label>Salary payment (UGX)<input className={field} type="number" min="1" step="1" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
    <label>External charge (UGX)<input className={field} type="number" min="0" step="1" value={fee} onChange={e=>setFee(e.target.value)}/></label>
    <label>Payment date<input className={field} type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
    <label>Payment reference<input className={field} maxLength={150} value={reference} onChange={e=>setReference(e.target.value)}/></label>
    <label>Verified recipient details<input className={field} maxLength={150} value={recipient} onChange={e=>setRecipient(e.target.value)}/></label>
    <button className="bg-slate-900 text-white p-3 rounded-lg" onClick={prepare}>Preview settlement</button>
   </div>:<div className="bg-slate-50 p-4 rounded-lg space-y-2">
    <p>Salary payable reduced by UGX {principal.toLocaleString()}.</p><p>Separate charge expense: UGX {charge.toLocaleString()}.</p>
    <p>Account debit: UGX {total.toLocaleString()}. Account balance after: UGX {(account?.balanceUGX-total).toLocaleString()}.</p>
    <p>Remaining salary payable: UGX {(position.outstandingUGX-principal).toLocaleString()}.</p><p>{date} | {reference} | {recipient}</p>
    <button className="bg-indigo-700 text-white p-3 rounded-lg mr-3" disabled={posting} onClick={confirm}>{posting?'Posting…':'Confirm verified payment'}</button><button disabled={posting} onClick={()=>setPreview(false)}>Edit</button>
   </div>}
   <details open={register} onToggle={e=>setRegister(e.currentTarget.open)}><summary className="cursor-pointer text-sm font-bold">Register a zero-opening funding account</summary><div className="grid sm:grid-cols-2 gap-3 mt-3">
    <label>Account ID<input className={field} value={newId} onChange={e=>setNewId(e.target.value)}/></label><label>Account name<input className={field} value={newName} onChange={e=>setNewName(e.target.value)}/></label>
    <label>Type<select className={field} value={newKind} onChange={e=>setNewKind(e.target.value)}>{['BANK','BRANCH_CASH_SALES','PETTY_CASH','MTN_MOBILE_MONEY','AIRTEL_MONEY'].map(kind=><option key={kind}>{kind}</option>)}</select></label>
    <label>Owning branch<select className={field} value={newBranch} onChange={e=>setNewBranch(e.target.value)}>{branchIds.map(id=><option key={id}>{id}</option>)}</select></label>
    <label>Reconciliation reference<input className={field} value={openingRef} onChange={e=>setOpeningRef(e.target.value)}/></label><p className="text-xs">Opening balance: UGX 0. Existing account balances cannot be replaced through registration.</p>
    <button disabled={posting} className="border rounded-lg p-2" onClick={createAccount}>Register account</button>
   </div></details>
   <div><h4 className="font-bold mb-2">Immutable payment history</h4>{history.length?history.map(h=><div key={h.id} className="border-t py-2 text-sm">{h.paymentDate}: UGX {h.amountUGX.toLocaleString()} + fee UGX {h.chargeUGX.toLocaleString()} | {h.externalReference} | {h.accountId} | {h.actorUid}</div>):<p className="text-sm">No verified salary settlements.</p>}</div>
 </section></div>;
}
