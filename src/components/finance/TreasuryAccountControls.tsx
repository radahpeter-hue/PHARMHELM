import React,{useRef,useState} from 'react';
import type {FinancialPortfolio} from '../../domain/finance/financialPortfolio';
import type {ManagementPaymentAccount} from '../../services/managementCashPosting';
import {registerPortfolioFunding,postPortfolioFundingMovement,portfolioPostingIdentity,transferPortfolioFunding,type PortfolioFundingAccount} from '../../domain/finance/portfolioFunding';
import {setCustomPortfolioActive,setRegisteredBankAccountActive,removeUnusedPortfolio} from '../../domain/finance/portfolioFirestore';

export const treasuryField='mt-1 min-h-11 w-full min-w-0 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-500';
export const treasuryButton='min-h-11 rounded-xl bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-50';
export function TreasuryAccountControls({portfolio,account,accounts,actorId,onChanged,transferOnly=false}:{transferOnly?:boolean;portfolio:FinancialPortfolio;account?:ManagementPaymentAccount;accounts:ManagementPaymentAccount[];actorId:string;onChanged:()=>void}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');const locked=useRef(false);
 const [opening,setOpening]=useState(''),[openingRef,setOpeningRef]=useState('');
 const [amount,setAmount]=useState(''),[reference,setReference]=useState(''),[direction,setDirection]=useState<'inflow'|'outflow'>('inflow');
 const [destination,setDestination]=useState(''),[transferAmount,setTransferAmount]=useState(''),[transferRef,setTransferRef]=useState('');
 const [reason,setReason]=useState(''),[removed,setRemoved]=useState(false);
 if(removed)return <p role="status" className="rounded-xl bg-white p-4 text-sm text-zinc-900">Unused account deleted. Audit identity retained.</p>;
 async function run(action:()=>Promise<string>){if(locked.current)return;locked.current=true;setBusy(true);setMessage('');try{setMessage(await action());onChanged();}catch(e){setMessage(e instanceof Error?e.message:'Financial action failed.');}finally{locked.current=false;setBusy(false);}}
 const active=portfolio.status==='active';
 return <section aria-label="Account controls" className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-4 text-zinc-900">
  <h4 className="font-semibold">Account controls</h4>
  {!account&&active&&<form className="grid gap-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();void run(async()=>{await registerPortfolioFunding({portfolio,actorId,name:portfolio.name,openingBalanceUGX:Number(opening),reconciliationReference:openingRef});setOpening('');setOpeningRef('');return 'Verified opening reconciliation saved.';});}}>
   <p className="text-sm text-amber-900 sm:col-span-2">Confirm the actual opening balance against a cash count or statement. Existing balances cannot be reset here.</p>
   <label className="text-sm">Verified opening balance (UGX)<input required type="number" min="0" step="1" value={opening} onChange={e=>setOpening(e.target.value)} className={treasuryField}/></label>
   <label className="text-sm">Opening reconciliation reference<input required minLength={5} value={openingRef} onChange={e=>setOpeningRef(e.target.value)} className={treasuryField}/></label>
   <button disabled={busy} className={treasuryButton}>Confirm opening reconciliation</button>
  </form>}
  {account&&active&&<>
   {!transferOnly&&<details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">Record verified movement</summary>
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();void run(async()=>{await postPortfolioFundingMovement({account:account as PortfolioFundingAccount,actorId,amountUGX:Number(amount),direction,reference,requestId:await portfolioPostingIdentity(account.tenantId,account.accountId,direction,reference)});setAmount('');setReference('');return 'Movement recorded in the authoritative ledger.';});}}>
     <label className="text-sm">Movement direction<select value={direction} onChange={e=>setDirection(e.target.value as typeof direction)} className={treasuryField}><option value="inflow">Inflow</option><option value="outflow">Outflow</option></select></label>
     <label className="text-sm">Movement amount (UGX)<input required type="number" min="1" step="1" value={amount} onChange={e=>setAmount(e.target.value)} className={treasuryField}/></label>
     <label className="text-sm">External transaction reference<input required minLength={3} value={reference} onChange={e=>setReference(e.target.value)} className={treasuryField}/></label>
     <button disabled={busy} className={treasuryButton}>Record verified movement</button>
    </form>
   </details>}
   <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">Transfer between reconciled portfolios</summary>
    <p className="mb-3 text-xs text-zinc-600">Both ledgers and balances update together. Allocate overlapping legacy bank reserves by transfer; never reconcile the same funds twice.</p>
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();void run(async()=>{const to=accounts.find(a=>a.accountId===destination);if(!to)throw Error('Select a reconciled destination.');const result=await transferPortfolioFunding({from:account,to,actorId,amountUGX:Number(transferAmount),externalReference:transferRef});setTransferAmount('');setTransferRef('');return result.replayed?'Transfer already recorded; no duplicate created.':'Both portfolio ledgers and balances transferred atomically.';});}}>
     <label className="text-sm">Destination portfolio<select required value={destination} onChange={e=>setDestination(e.target.value)} className={treasuryField}><option value="">Select account</option>{accounts.filter(a=>a.tenantId===account.tenantId&&a.initialized&&a.accountId!==account.accountId).map(a=><option key={a.id} value={a.accountId}>{a.name}</option>)}</select></label>
     <label className="text-sm">Transfer amount (UGX)<input required min="1" step="1" type="number" value={transferAmount} onChange={e=>setTransferAmount(e.target.value)} className={treasuryField}/></label>
     <label className="text-sm">Transfer reference<input required minLength={5} value={transferRef} onChange={e=>setTransferRef(e.target.value)} className={treasuryField}/></label>
     <button disabled={busy} className={treasuryButton}>Transfer atomically</button>
    </form>
   </details>
  </>}
  {portfolio.origin==='custom'&&<form className="flex flex-wrap items-end gap-3 border-t border-zinc-100 pt-3" onSubmit={e=>{e.preventDefault();void run(async()=>{const update=portfolio.bankParentId?setRegisteredBankAccountActive:setCustomPortfolioActive;await update(portfolio,!active,actorId,reason);return active?'Account deactivated; financial history retained.':'Account reactivated with its original identity.';});}}>
   <p className="w-full text-xs text-zinc-600">Accounts can be deactivated once their balance is zero. Financial history is retained.</p>
   {active&&<label className="min-w-0 flex-1 text-sm">Deactivation reason<input required value={reason} onChange={e=>setReason(e.target.value)} className={treasuryField}/></label>}
   <button disabled={busy} className="min-h-11 rounded-xl border border-zinc-300 px-4 text-sm font-semibold">{active?'Deactivate account':'Reactivate account'}</button>
  </form>}
  {portfolio.origin==='custom'&&!active&&!account&&!portfolio.supportsChildAccounts&&<form className="space-y-3 border-t border-zinc-100 pt-3" onSubmit={e=>{e.preventDefault();void run(async()=>{await removeUnusedPortfolio(portfolio,actorId,reason);setRemoved(true);return 'Unused account deleted; audit identity retained.';});}}>
   <p className="text-xs text-zinc-600">Delete only an unused account with no opening reconciliation. Its audit identity is retained and cannot be reused.</p>
   <label className="block text-sm">Deletion reason<input required value={reason} onChange={e=>setReason(e.target.value)} className={treasuryField}/></label>
   <button disabled={busy} className="min-h-11 rounded-xl border border-red-300 px-4 text-sm font-semibold text-red-800">Delete unused account</button>
  </form>}
  {message&&<p role="status" className="break-words text-sm">{message}</p>}
 </section>;
}
