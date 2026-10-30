import React,{useEffect,useState} from 'react';
import {useAuth} from '../../contexts/AuthContext';
import {listFinancialPortfolios,createCustomFinancialPortfolio,listPortfolioAccounts} from '../../domain/finance/portfolioFirestore';
import {defaultLedgerQuery} from '../../domain/finance/portfolioLedger';
import type {FinancialPortfolio,FinancialPortfolioClassification} from '../../domain/finance/financialPortfolio';
import type {PortfolioChildAccount} from '../../domain/finance/portfolioAccounts';
import {hasAnyRole} from '../../utils/roles';

export function FinancialPortfoliosPanel(){
 const {profile,activeBranchId}=useAuth();
 const tenantId=profile?.tenantId||'';
 const canCreate=hasAnyRole(profile,['owner','CEO','CEO / MD']);
 // Portfolio registration remains disabled until dedicated CEO-only rules are certified.
 const registrationEnabled=false;
 const [items,setItems]=useState<FinancialPortfolio[]>([]);
 const [accounts,setAccounts]=useState<PortfolioChildAccount[]>([]);
 const [name,setName]=useState('');
 const [classification,setClassification]=useState<FinancialPortfolioClassification>('restricted_internal_fund');
 const [message,setMessage]=useState('');
 const [busy,setBusy]=useState(false);
 const [selected,setSelected]=useState<string>('');
 const [direction,setDirection]=useState<'all'|'inflow'|'outflow'>('all');
 const [period,setPeriod]=useState(()=>defaultLedgerQuery(new Date().toISOString().slice(0,10)));
 useEffect(()=>{
  let active=true;
  if(!tenantId)return;
  Promise.all([listFinancialPortfolios(tenantId),listPortfolioAccounts(tenantId)])
   .then(([p,a])=>{if(active){setItems(p);setAccounts(a);}})
   .catch(()=>{if(active)setMessage('Portfolio records unavailable.');});
  return ()=>{active=false;};
 },[tenantId]);
 async function create(event:React.FormEvent){
  event.preventDefault();
  if(!tenantId||!profile?.uid||!canCreate||busy)return;
  setBusy(true);setMessage('');
  try{
   const created=await createCustomFinancialPortfolio({
    id:'custom_'+crypto.randomUUID().replace(/-/g,''),
    tenantId,name,classification,description:'Custom financial portfolio',
    scope:{kind:'organisation'},currency:'UGX',origin:'custom',
    supportsChildAccounts:false,allowsTransfersIn:true,allowsTransfersOut:true,
    createdBy:profile.uid,createdAt:new Date().toISOString()
   });
   setItems(old=>[...old,created]);setName('');setMessage('Portfolio registered.');
  }catch(error){setMessage(error instanceof Error?error.message:'Portfolio creation failed.');}
  finally{setBusy(false);}
 }
 const visible=items.filter(p=>p.scope.kind==='organisation'||p.scope.branchId===activeBranchId);
 const selectedPortfolio=visible.find(p=>p.id===selected);
 return <section className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-4">
  <div><h3 className="text-lg font-bold text-zinc-950">Financial Portfolios (Level 4)</h3><p className="text-sm text-zinc-600">New portfolio registry. Historical treasury accounts are not migrated. Registration is currently disabled pending validated finance security rules. Unverified balances are not displayed as zero.</p></div>
  <div className="grid gap-2 sm:grid-cols-2">{visible.map(p=><button key={p.id} onClick={()=>setSelected(p.id)} className="rounded-lg border border-zinc-300 text-left p-3 text-zinc-900"><strong>{p.name}</strong><p className="text-xs">{p.classification} · {p.status} · Balance not established</p></button>)}</div>
  {selectedPortfolio&&<div className="rounded-lg border p-3 space-y-2 text-sm text-zinc-800">
   <strong>{selectedPortfolio.name} · Account overview</strong>
   <p>{accounts.filter(a=>a.portfolioId===selectedPortfolio.id).length} registered child accounts. Independent ledger posting is not yet enabled.</p>
   <div className="flex gap-2"><select aria-label="Movement direction" value={direction} onChange={e=>setDirection(e.target.value as typeof direction)} className="border p-2"><option value="all">All</option><option value="inflow">Inflows</option><option value="outflow">Outflows</option></select><input aria-label="From date" type="date" value={period.from} onChange={e=>setPeriod(p=>({...p,from:e.target.value}))} className="border p-2"/><input aria-label="To date" type="date" value={period.to} onChange={e=>setPeriod(p=>({...p,to:e.target.value}))} className="border p-2"/></div>
   <p>Ledger unavailable pending authoritative posting integration; no synthetic transactions shown.</p>
  </div>}
  {canCreate&&registrationEnabled&&<form onSubmit={create} className="grid gap-2 sm:grid-cols-3"><input required maxLength={120} aria-label="Portfolio name" value={name} onChange={e=>setName(e.target.value)} placeholder="Portfolio name" className="border p-2 rounded"/><select aria-label="Portfolio classification" value={classification} onChange={e=>setClassification(e.target.value as FinancialPortfolioClassification)} className="border p-2 rounded"><option value="restricted_internal_fund">Internal fund</option><option value="other_financial_asset">Other financial asset</option><option value="cash_equivalent">Cash equivalent</option></select><button disabled={busy} className="bg-emerald-800 text-white rounded p-2">Create portfolio</button></form>}
  {message&&<p role="status" className="text-sm">{message}</p>}
 </section>;
}
