import React, { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import {MANAGEMENT_BANK_ACCOUNT,MANAGEMENT_CASH_ACCOUNT,type ManagementPaymentAccount} from '../../services/managementCashPosting';
import { registerManagementPaymentAccount } from '../../services/managementPaymentAccountService';

export function useManagementPaymentAccounts() {
  const { profile, hasPermission } = useAuth();
  const [state,setState]=useState<{tenantId:string;accounts:ManagementPaymentAccount[];error:string;loading:boolean}>({tenantId:'',accounts:[],error:'',loading:true});
  const tenantId=profile?.tenantId||'',canView=hasPermission('finance','view');
  useEffect(()=>{
    setState({tenantId,accounts:[],error:'',loading:true});
    if(!tenantId||!canView){setState({tenantId,accounts:[],error:'Finance access is required.',loading:false});return;}
    return onSnapshot(query(collection(db,'finance_payment_accounts'),where('tenantId','==',tenantId)),snapshot=>setState({tenantId,accounts:snapshot.docs.map(d=>({...d.data(),id:d.id}) as ManagementPaymentAccount).filter(a=>a.accountId===MANAGEMENT_BANK_ACCOUNT||a.accountId===MANAGEMENT_CASH_ACCOUNT),error:'',loading:false}),()=>setState({tenantId,accounts:[],error:'Unable to load payment accounts.',loading:false}));
  },[tenantId,canView]);
  return state.tenantId===tenantId?state:{tenantId,accounts:[],error:'',loading:true};
}

export function ManagementPaymentAccounts() {
  const {profile,hasPermission}=useAuth();
  const {accounts,error,loading}=useManagementPaymentAccounts();
  const [kind,setKind]=useState<'petty_cash'|'bank'>('petty_cash');
  const [name,setName]=useState('Management Petty Cash');
  const [reference,setReference]=useState('');
  const [opening,setOpening]=useState('');
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const busyRef=useRef(false);
  const canRegister=hasPermission('finance','operate');
  const register=async(event:React.FormEvent)=>{
    event.preventDefault();if(!profile?.tenantId||!canRegister||busyRef.current)return;
    busyRef.current=true;setBusy(true);setMessage('');
    try{
      const result=await registerManagementPaymentAccount({tenantId:profile.tenantId,actorId:profile.uid,kind,name,reconciliationReference:reference,...(kind==='bank'?{bankOpeningBalanceUGX:Number(opening)}:{})});
      setMessage(`Registered with reconciled opening balance UGX ${result.openingBalanceUGX.toLocaleString()}.`);setReference('');
    }catch(e){setMessage(e instanceof Error?e.message:'Account registration failed.');}
    finally{busyRef.current=false;setBusy(false);}
  };
  return <section className="min-w-0 rounded-2xl border border-zinc-300 bg-white p-4 text-zinc-900 sm:p-5">
    <h3 className="text-lg font-bold text-zinc-950">Management payment accounts</h3>
    <p className="mt-1 text-sm text-zinc-700">Supplier payments and cash postings use these reconciled account balances.</p>
    {loading?<p className="mt-3 text-sm text-zinc-700">Loading accounts…</p>:error?<p role="alert" className="mt-3 text-sm text-red-800">{error}</p>:<div className="mt-3 grid gap-3 sm:grid-cols-2">{accounts.map(account=><div key={account.id} className="min-w-0 rounded-xl border border-zinc-200 p-3"><p className="break-words font-bold text-zinc-950">{account.name}</p><p className="text-sm text-zinc-700">{account.kind==='bank'?'Bank':'Petty cash'} · UGX {Number(account.balanceUGX).toLocaleString()}</p><p className="mt-1 break-words text-xs text-zinc-700">Opening reconciliation: {account.reconciliationReference}</p></div>)}{!accounts.length&&<p className="text-sm font-medium text-amber-900">Register and reconcile a funding account before posting cash or supplier payments.</p>}</div>}
    {canRegister&&!loading&&!error&&accounts.length<2&&<details className="mt-4"><summary className="min-h-11 cursor-pointer py-2 font-semibold text-zinc-900">Register a missing account</summary><form onSubmit={register} className="mt-2 grid gap-3">
      <label className="text-sm font-medium text-zinc-900">Account type<select value={kind} onChange={e=>{const value=e.target.value as 'petty_cash'|'bank';setKind(value);setName(value==='bank'?'Management Bank':'Management Petty Cash');}} className="mt-1 min-h-11 w-full rounded-xl border border-zinc-400 bg-white p-2 text-zinc-900"><option value="petty_cash" disabled={accounts.some(a=>a.kind==='petty_cash')}>Management Petty Cash</option><option value="bank" disabled={accounts.some(a=>a.kind==='bank')}>Management Bank</option></select></label>
      <label className="text-sm font-medium text-zinc-900">Registered account name<input required value={name} onChange={e=>setName(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-zinc-400 bg-white p-2 text-zinc-900"/></label>
      <label className="text-sm font-medium text-zinc-900">Reconciliation reference<input required minLength={5} value={reference} onChange={e=>setReference(e.target.value)} placeholder="Cash count or bank statement reference" className="mt-1 min-h-11 w-full rounded-xl border border-zinc-400 bg-white p-2 text-zinc-900"/></label>
      {kind==='bank'?<label className="text-sm font-medium text-zinc-900">Verified bank opening balance (UGX)<input required type="number" min="0" step="1" value={opening} onChange={e=>setOpening(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-zinc-400 bg-white p-2 text-zinc-900"/></label>:<p className="text-sm text-zinc-700">The opening petty-cash balance is reconciled from the existing ledger. Historical entries are retained.</p>}
      <button disabled={busy||accounts.some(a=>a.kind===kind)} className="min-h-11 rounded-xl bg-emerald-800 px-4 py-3 font-bold text-white disabled:opacity-50">{busy?'Registering…':'Confirm opening reconciliation'}</button>
    </form></details>}
    {message&&<p role="status" className="mt-3 text-sm font-medium text-zinc-900">{message}</p>}
  </section>;
}
