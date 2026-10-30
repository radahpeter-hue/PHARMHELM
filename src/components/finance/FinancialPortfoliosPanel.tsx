import {useManagementPaymentAccounts} from './ManagementPaymentAccounts';
import React,{useEffect,useState} from 'react';
import {useAuth} from '../../contexts/AuthContext';
import {
 listFinancialPortfolios,createCustomFinancialPortfolio,registerPortfolioBankIdentity,registeredBankAccounts,setRegisteredBankAccountActive
} from '../../domain/finance/portfolioFirestore';
import {defaultLedgerQuery} from '../../domain/finance/portfolioLedger';
import type {FinancialPortfolio,FinancialPortfolioClassification} from '../../domain/finance/financialPortfolio';
import type {PortfolioChildAccount} from '../../domain/finance/portfolioAccounts';
import {hasAnyRole} from '../../utils/roles';

/** Level 4 registry: financial movements and unverified balances are never fabricated. */
export function FinancialPortfoliosPanel(){
 const {profile,activeBranchId}=useAuth();
 const tenantId=profile?.tenantId||'';
 const treasury=useManagementPaymentAccounts();
 const canRegister=hasAnyRole(profile,['owner','CEO','CEO / MD']);
 const [items,setItems]=useState<FinancialPortfolio[]>([]);
 const [accounts,setAccounts]=useState<PortfolioChildAccount[]>([]);
 const [name,setName]=useState('');
 const [classification,setClassification]=useState<FinancialPortfolioClassification>('restricted_internal_fund');
 const [scopeKind,setScopeKind]=useState<'organisation'|'branch'>('organisation');
 const [supportsChildren,setSupportsChildren]=useState(false);
 const [bankInstitution,setBankInstitution]=useState('');
 const [bankAccountName,setBankAccountName]=useState('');
 const [bankReference,setBankReference]=useState('');
 const [message,setMessage]=useState('');
 const [busy,setBusy]=useState(false);
 const [selected,setSelected]=useState('');
 const [direction,setDirection]=useState<'all'|'inflow'|'outflow'>('all');
 const [period,setPeriod]=useState(()=>defaultLedgerQuery(new Date().toISOString().slice(0,10)));
 useEffect(()=>{
   let live=true;
   setItems([]);setAccounts([]);
   if(!tenantId)return;
   listFinancialPortfolios(tenantId)
     .then(p=>{if(live){setItems(p);setAccounts([]);setMessage('');}})
     .catch(()=>{if(live)setMessage('Portfolio registry is currently unavailable.');});
   return ()=>{live=false;};
 },[tenantId,activeBranchId]);
 async function create(event:React.FormEvent){
   event.preventDefault();
   if(!tenantId||!profile?.uid||!canRegister||busy)return;
   if(scopeKind==='branch'&&!activeBranchId){setMessage('Choose a branch before creating a branch portfolio.');return;}
   setBusy(true);setMessage('');
   try{
     const created=await createCustomFinancialPortfolio({
       id:'custom_'+crypto.randomUUID().replace(/-/g,''),
       tenantId,name,classification,description:'CEO-registered financial portfolio',
       scope:scopeKind==='branch'?{kind:'branch',branchId:activeBranchId!}:{kind:'organisation'},
       currency:'UGX',origin:'custom',
       supportsChildAccounts:false,allowsTransfersIn:true,allowsTransfersOut:true,
       createdBy:profile.uid,createdAt:new Date().toISOString()
     });
     setItems(old=>[...old,created]);setName('');setMessage('Portfolio registered; no balance has been reconciled.');
   }catch(error){setMessage(error instanceof Error?error.message:'Portfolio registration failed.');}
   finally{setBusy(false);}
 }
 const selectedPortfolio=items.find(p=>p.id===selected);
 const childAccounts=accounts.filter(a=>a.portfolioId===selectedPortfolio?.id);

 async function registerBankAccount(event:React.FormEvent){
   event.preventDefault();
   if(!tenantId||!profile?.uid||!canRegister||busy)return;
   setBusy(true);setMessage('');
   try{
     const bank=await registerPortfolioBankIdentity({
       tenantId,actorId:profile.uid,institution:bankInstitution,
       accountReference:bankReference,displayName:bankAccountName,createdAt:new Date().toISOString()
     });
     setItems(old=>[...old,bank]);setBankInstitution('');setBankAccountName('');setBankReference('');
     setMessage('Bank account identity registered. Reconciled balance and posting are not yet enabled.');
   }catch(error){setMessage(error instanceof Error?error.message:'Bank registration failed.');}
   finally{setBusy(false);}
 }
 async function changeBankStatus(bank:FinancialPortfolio){
   if(!canRegister||busy)return;
   const deactivate=bank.status==='active';
   const reason=deactivate?'Bank account deactivated by CEO':'';
   setBusy(true);setMessage('');
   try{
     const updated=await setRegisteredBankAccountActive(bank,!deactivate,profile!.uid,reason);
     setItems(old=>old.map(p=>p.id===updated.id?updated:p));
     setMessage(deactivate?'Account deactivated; identity retained.':'Account reactivated with original identity.');
   }catch(e){setMessage(e instanceof Error?e.message:'Unable to update bank status.');}
   finally{setBusy(false);}
 }
 const bankIdentities=registeredBankAccounts(items);
 return <section className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-4">
  <div><h3 className="text-lg font-bold text-zinc-950">Financial Portfolio Registry</h3>
   <p className="text-sm text-zinc-600">New portfolios are tenant scoped. Legacy treasury balances are not silently migrated and unavailable financial balances are never displayed as zero.</p></div>
  <div className="space-y-2">
    <h4 className="font-semibold text-zinc-900">Existing reconciled Management portfolios</h4>
    {treasury.loading?<p className="text-sm">Loading reconciled payment accounts…</p>:
     treasury.error?<p role="alert" className="text-sm">{treasury.error}</p>:
     <div className="grid gap-2 sm:grid-cols-2">
      {treasury.accounts.filter(a=>a.initialized&&a.currency==='UGX'&&Number.isSafeInteger(a.balanceUGX)).map(a=>
       <div key={a.id} className="rounded-lg border border-zinc-200 p-3">
        <strong>{a.name}</strong><p className="text-xs">{a.kind==='bank'?'Management Bank':'Management Petty Cash'} · Reconciled</p>
        <p className="font-semibold">UGX {a.balanceUGX.toLocaleString()}</p>
        <p className="text-xs">Opening reconciliation: {a.reconciliationReference}</p>
       </div>)}
      {!treasury.accounts.length&&<p className="text-sm">No Management payment account has been reconciled.</p>}
     </div>}
    <p className="text-xs text-zinc-600">Read directly from existing authoritative finance_payment_accounts. Not added to or double-counted with the new registry.</p>
  </div>
<div className="space-y-2">
   <h4 className="font-semibold text-zinc-900">Registered bank accounts ({bankIdentities.length})</h4>
   {bankIdentities.map(bank=><div key={bank.id} className="rounded-lg border border-zinc-200 p-3 text-sm">
    <strong>{bank.name}</strong> · {bank.bankInstitution} · {bank.status}
    <p>Account reference: {bank.bankAccountReference}. Balance not yet reconciled.</p>{canRegister&&<button type="button" disabled={busy} onClick={()=>changeBankStatus(bank)} className="mt-2 rounded border border-zinc-400 px-3 py-1">{bank.status==='active'?'Deactivate':'Reactivate'}</button>}
   </div>)}
   {canRegister&&<form onSubmit={registerBankAccount} className="grid gap-2 sm:grid-cols-4">
     <input required maxLength={100} aria-label="Bank institution" placeholder="Bank name" value={bankInstitution} onChange={e=>setBankInstitution(e.target.value)} className="border p-2 rounded"/>
     <input required maxLength={120} aria-label="Bank account display name" placeholder="Account name" value={bankAccountName} onChange={e=>setBankAccountName(e.target.value)} className="border p-2 rounded"/>
     <input required maxLength={60} aria-label="Bank account reference" placeholder="Account number" value={bankReference} onChange={e=>setBankReference(e.target.value)} className="border p-2 rounded"/>
     <button disabled={busy} className="rounded bg-emerald-800 text-white p-2">Register bank account</button>
   </form>}
  </div>
    <div className="grid gap-2 sm:grid-cols-2">
   {items.map(p=><button key={p.id} type="button" onClick={()=>setSelected(p.id)}
     className="rounded-lg border border-zinc-300 text-left p-3 text-zinc-900" aria-pressed={selected===p.id}>
    <strong>{p.name}</strong><p className="text-xs">{p.classification} · {p.scope.kind==='branch'?p.scope.branchId:'Organisation'} · {p.status}</p>
    <p className="text-xs font-semibold">Balance: not established</p></button>)}
   {!items.length&&<p className="text-sm text-zinc-600">No custom portfolios registered for this scope.</p>}
  </div>
  {selectedPortfolio&&<div className="rounded-lg border border-zinc-300 p-3 space-y-3 text-sm text-zinc-800">
   <strong>{selectedPortfolio.name} — Account overview</strong>
   <p>{childAccounts.length} child accounts. Authoritative ledger posting and child-account registration are not yet enabled.</p>
   {childAccounts.map(a=><div key={a.id} className="rounded-md border border-zinc-200 p-2">
     <strong>{a.displayName}</strong> · {a.institution||'Financial account'} · {a.status}
     <p>Account reference: {a.accountReference} · Opening balance not reconciled</p></div>)}
   <div className="flex flex-wrap gap-2">
     <select aria-label="Movement direction" value={direction} onChange={e=>setDirection(e.target.value as typeof direction)} className="border p-2"><option value="all">All</option><option value="inflow">Inflows</option><option value="outflow">Outflows</option></select>
     <input aria-label="From date" type="date" value={period.from} onChange={e=>setPeriod(p=>({...p,from:e.target.value}))} className="border p-2"/>
     <input aria-label="To date" type="date" value={period.to} onChange={e=>setPeriod(p=>({...p,to:e.target.value}))} className="border p-2"/>
   </div>
   <p>Ledger unavailable pending authoritative financial posting integration; no synthetic transactions shown.</p>
  </div>}
  {canRegister&&<form onSubmit={create} className="grid gap-2 sm:grid-cols-3">
    <input required maxLength={120} aria-label="Portfolio name" value={name} onChange={e=>setName(e.target.value)} placeholder="Portfolio name" className="border p-2 rounded"/>
    <select aria-label="Portfolio classification" value={classification} onChange={e=>setClassification(e.target.value as FinancialPortfolioClassification)} className="border p-2 rounded">
      <option value="restricted_internal_fund">Internal fund</option>
      <option value="other_financial_asset">Other financial asset</option><option value="cash_equivalent">Cash equivalent</option>
    </select>
    <select aria-label="Portfolio scope" value={scopeKind} onChange={e=>setScopeKind(e.target.value as typeof scopeKind)} className="border p-2 rounded">
      <option value="organisation">Organisation / HQ</option>
    </select>
    <p className="text-xs text-zinc-600">Child-account and branch-specific registration will be enabled after separate security certification.</p>
    <button disabled={busy} className="rounded bg-emerald-800 text-white p-2">{busy?'Processing…':'Create portfolio'}</button>
  </form>}
  {message&&<p role="status" className="text-sm text-zinc-800">{message}</p>}
 </section>;
}
