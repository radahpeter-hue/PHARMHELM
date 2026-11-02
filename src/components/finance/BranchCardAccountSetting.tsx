import React, {useEffect,useState} from 'react';
import {useAuth} from '../../contexts/AuthContext';
import {listFinancialPortfolios} from '../../domain/finance/portfolioFirestore';
import type {FinancialPortfolio} from '../../domain/finance/financialPortfolio';
import {readBranchCardSettlement,saveBranchCardSettlement} from '../../domain/finance/branchCardSettlement';
import {hasAnyRole} from '../../utils/roles';

export function BranchCardAccountSetting({branchId}:{branchId:string}) {
 const {profile}=useAuth();
 const [banks,setBanks]=useState<FinancialPortfolio[]>([]),[selected,setSelected]=useState('');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{
  let live=true;setSelected('');setBanks([]);setMessage('');
  if(!profile?.tenantId||!branchId)return;
  Promise.all([listFinancialPortfolios(profile.tenantId),readBranchCardSettlement(profile.tenantId,branchId)])
   .then(([rows,config])=>{if(live){setBanks(rows.filter(p=>p.classification==='bank'&&p.bankParentId==='system_bank'&&p.status==='active'));setSelected(config?.bankPortfolioId||'');}})
   .catch(()=>{if(live)setMessage('Unable to load card receiving account.');});
  return ()=>{live=false;};
 },[profile?.tenantId,branchId]);
 async function save(){
  const bank=banks.find(b=>b.id===selected);if(!bank||!profile||busy)return;
  setBusy(true);setMessage('');
  try{await saveBranchCardSettlement({tenantId:profile.tenantId,branchId,bank,actorId:profile.uid});setMessage('Default card receiving account saved.');}
  catch(e){setMessage(e instanceof Error?e.message:'Unable to save card account.');}finally{setBusy(false);}
 }
 return <div className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 space-y-3">
  <h4 className="font-bold">Card payment receiving account</h4>
  <p className="text-sm text-slate-500">Card collections from this branch’s EOD reconciliation go to the selected bank account.</p>
  <select aria-label="Default card receiving bank account" value={selected} onChange={e=>setSelected(e.target.value)} disabled={!hasAnyRole(profile,['owner','CEO','CEO / MD'])||busy} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-slate-900">
   <option value="">Choose a registered bank account</option>{banks.map(b=><option key={b.id} value={b.id}>{b.name} · {b.bankInstitution}</option>)}
  </select>
  {hasAnyRole(profile,['owner','CEO','CEO / MD'])&&<button type="button" onClick={save} disabled={busy||!selected} className="rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white disabled:opacity-50">{busy?'Saving…':'Save card account'}</button>}
  {message&&<p role="status" className="text-sm">{message}</p>}
 </div>;
}
