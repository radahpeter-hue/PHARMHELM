import React,{useState} from 'react';
import type {AuthoritativePortfolioLedger} from '../../domain/finance/authoritativePortfolioLedger';
import {type FinancialLedgerEntry} from '../../domain/finance/portfolioLedger';
import {summarizeBranchContributions} from '../../domain/finance/portfolioBranchContributions';
import {treasuryField} from './TreasuryAccountControls';
import {ArrowDownLeft, ArrowUpRight, List, Wallet, ShieldCheck} from 'lucide-react';
import {TreasuryLedgerExports} from './TreasuryLedgerExports';
import {TreasuryKpi, treasuryDateTime, treasuryGrid} from './TreasuryPresentation';

const transferLabels={transfer_in:'Transfer In',transfer_out:'Transfer Out',transfer_charge:'Transfer Charge'};
const movementLabel=(entry:FinancialLedgerEntry)=>entry.transferClass?transferLabels[entry.transferClass]:
 entry.eodReconciliationId?'EOD settlement':entry.direction==='inflow'?'Inflow':'Outflow';

const eodChannels:Record<string,string>={cash:'Cash',card:'Card',momo:'MTN Money',airtel:'Airtel Money'};

export function TreasuryLedger({ledgers,branches,bank=false,balance,initialReference='',partial=false,accountCount,audit=false,aside}:{ledgers:AuthoritativePortfolioLedger[];branches:Array<{id:string;name:string}>;bank?:boolean;balance:string;initialReference?:string;partial?:boolean;accountCount?:number;audit?:boolean;aside?:React.ReactNode}){
 const [from,setFrom]=useState(''),[to,setTo]=useState(''),[direction,setDirection]=useState('all'),[branch,setBranch]=useState('all');
 const [detail,setDetail]=useState<FinancialLedgerEntry|null|undefined>(undefined);
 const [account,setAccount]=useState('all'),[search,setSearch]=useState(''),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(10);
 const entries=ledgers.flatMap(l=>l.entries.map(entry=>({...entry,accountName:l.account.name,ledgerAccount:l.account.accountId})))
   .sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)||b.id.localeCompare(a.id));
 const showBalance=!partial&&(ledgers.length===1||account!=='all')&&entries.every(e=>Number.isSafeInteger(e.runningBalanceUGX));
 const dated=entries.filter(e=>(!from||e.businessDate>=from)&&(!to||e.businessDate<=to));
 const period=dated.filter(e=>(account==='all'||e.ledgerAccount===account)&&(branch==='all'||(branch==='unattributed'?!e.branchId:e.branchId===branch)));
 const label=(id?:string)=>branches.find(b=>b.id===id)?.name||id||'Unattributed';
 const displayReference=(entry:FinancialLedgerEntry)=>{
   const generatedEodReference=entry.reference.startsWith('eod_'+entry.eodReconciliationId+'_')
     ||(entry.description.startsWith('EOD correction')&&entry.id.startsWith(entry.reference+'~'));
   const hasBusinessReference=entry.reference&&entry.reference!==entry.id&&entry.reference!==entry.linkedRecordId&&!generatedEodReference;
   if(hasBusinessReference)return entry.reference;
   if(entry.eodReconciliationId){
     const kind=entry.description.startsWith('EOD correction')?'EOD correction':'EOD settlement';
     const channel=eodChannels[entry.eodChannel??''];
     return [kind,entry.businessDate,branches.find(b=>b.id===entry.branchId)?.name,channel].filter(Boolean).join(' · ');
   }
   return [entry.transferClass?movementLabel(entry):entry.description,entry.businessDate].join(' · ');
 };
 const matchesMovement=(entry:FinancialLedgerEntry)=>direction==='all'||entry.direction===direction
   ||entry.transferClass===direction||(direction==='eod'&&!!entry.eodReconciliationId)
   ||(direction==='other_in'&&!entry.transferClass&&entry.direction==='inflow')
   ||(direction==='other_out'&&!entry.transferClass&&entry.direction==='outflow');
 const filtered=period.filter(e=>matchesMovement(e)&&
   [displayReference(e),e.reference,e.description,String(e.amountUGX),e.accountName,label(e.branchId)].some(value=>value.toLowerCase().includes(search.trim().toLowerCase())));
 const pages=Math.max(1,Math.ceil(filtered.length/pageSize));
 const currentPage=Math.min(page,pages);
 const visible=filtered.slice((currentPage-1)*pageSize,currentPage*pageSize);
 const initialDetail=entries.find(e=>e.id===initialReference);
 const selected=detail===undefined?initialDetail:detail;
 const invalid=!!(from&&to&&from>to);
 const amount=(kind:string)=>{
   const total=period.reduce((sum,e)=>sum+(e.direction===kind?e.amountUGX:0),0);
   return partial||invalid||!Number.isSafeInteger(total)?'Unavailable':'UGX '+total.toLocaleString();
 };
 const exportRows=()=>filtered.map(e=>({
     Date:treasuryDateTime(e.businessDate,e.occurredAt),Reference:displayReference(e),Description:e.description,
     Account:e.accountName,...(audit?{'Posting ID':e.id,'Posted by':e.actorId}:{}),Branch:label(e.branchId),Type:movementLabel(e),
     'Inflow (UGX)':e.direction==='inflow'?e.amountUGX:'',
     'Outflow (UGX)':e.direction==='outflow'?e.amountUGX:'',
     ...(showBalance?{'Account balance (UGX)':e.runningBalanceUGX}:{}),
   }));
 const contributions=summarizeBranchContributions(dated);
 return <section className="min-w-0 space-y-4 rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
  <div><h3 className="font-semibold">{audit?'Bank posting audit trail':bank?'Unified Ledger':'Authoritative account ledger'}</h3><p className="mt-1 text-xs text-zinc-600">Full account history determines balances. Filters only select movements shown below.</p></div>
  <div className={treasuryGrid+(bank?' @min-[1160px]:grid-cols-5':'')}>
   <TreasuryKpi title={bank?'Consolidated bank balance':'Current verified balance'} value={balance} icon={Wallet}/>
   <TreasuryKpi title="Total inflows" value={amount('inflow')} icon={ArrowUpRight} note="Posted movements for selected period"/>
   <TreasuryKpi title="Total outflows" value={amount('outflow')} icon={ArrowDownLeft} tone="red" note="Includes transfers where applicable"/>
   <TreasuryKpi title={bank?'Registered accounts':'Transactions'} value={bank?String(accountCount??0):partial||invalid?'Unavailable':String(period.length)} icon={List} tone="blue"/>
   {bank&&<TreasuryKpi title="Reconciliation status" value={partial?'Coverage incomplete':'Verified'} icon={ShieldCheck} tone={partial?'amber':'green'}/>}
  </div>
  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
   <label className="text-sm">From date<input aria-label="Ledger from" type="date" value={from} onChange={e=>{setFrom(e.target.value);setPage(1)}} className={treasuryField}/></label>
   <label className="text-sm">To date<input aria-label="Ledger to" type="date" value={to} onChange={e=>{setTo(e.target.value);setPage(1)}} className={treasuryField}/></label>
   <label className="text-sm">Movement<select aria-label="Ledger direction" value={direction} onChange={e=>{setDirection(e.target.value);setPage(1)}} className={treasuryField}><option value="all">All movements</option><option value="inflow">Inflows</option><option value="outflow">Outflows</option>{Object.entries(transferLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}<option value="eod">EOD settlements</option><option value="other_in">Other inflows</option><option value="other_out">Other outflows</option></select></label>
   <label className="text-sm">Source branch<select aria-label="Filter ledger by source branch" value={branch} onChange={e=>{setBranch(e.target.value);setPage(1)}} className={treasuryField}><option value="all">All branches</option>{[...new Set([...branches.map(b=>b.id),...entries.flatMap(e=>e.branchId?[e.branchId]:[])])].map(id=><option key={id} value={id}>{label(id)}</option>)}<option value="unattributed">Unattributed / legacy</option></select></label>
   {bank&&<label className="text-sm">Bank account<select aria-label="Bank account" value={account} onChange={e=>{setAccount(e.target.value);setPage(1)}} className={treasuryField}><option value="all">All bank accounts</option>{ledgers.map(l=><option key={l.account.accountId} value={l.account.accountId}>{l.account.name}</option>)}</select></label>}
   <label className="text-sm">Search transactions<input value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Reference, description or amount" className={treasuryField}/></label>
   <TreasuryLedgerExports rows={exportRows} disabled={invalid||!filtered.length}/>
  </div>
  {partial&&<p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Coverage is incomplete. The table shows available verified account histories.</p>}
  <div className={aside?'grid gap-4 @min-[1080px]:grid-cols-[minmax(0,1fr)_250px]':'min-w-0'}>
   <div className="min-w-0 space-y-3">
  {from&&to&&from>to?<p role="alert" className="text-sm text-red-800">Choose an end date on or after the start date.</p>:<>
   <details><summary className="cursor-pointer py-2 text-sm font-semibold">Branch contributions for selected dates</summary><p className="text-xs text-zinc-600">Posted inflows and net movement, not independent branch bank balances.</p><div className="overflow-x-auto"><table className="w-full text-left text-sm text-zinc-900"><thead className="text-zinc-600"><tr><th className="p-3">Branch</th><th className="p-3">Inflows UGX</th><th className="p-3">Net UGX</th></tr></thead><tbody className="text-zinc-900">{contributions.branches.filter(b=>branch==='all'||branch===b.branchId).map(b=><tr key={b.branchId}><td className="p-3">{label(b.branchId)}</td><td className="p-3">{b.inflowUGX.toLocaleString()}</td><td className="p-3">{b.netUGX.toLocaleString()}</td></tr>)}</tbody></table></div></details>
   <div tabIndex={0} aria-label="Scrollable transaction table" className="overflow-x-auto rounded-xl border border-zinc-200">
    <table className="w-full min-w-[740px] text-left text-sm text-zinc-900">
     <thead className="bg-zinc-100 text-zinc-700"><tr>{['Date & time',...(bank?['Account']:[]),'Reference','Description','Branch','Type','Inflow (UGX)','Outflow (UGX)',...(audit?['Posting ID','Posted by']:[]),...(showBalance?['Account balance (UGX)']:[])].map((h,i)=><th key={h} scope="col" className={`px-2 py-3 font-semibold ${i>=(bank?6:5)?'text-right':''}`}>{h}</th>)}</tr></thead>
     <tbody>{visible.map(e=><tr key={e.ledgerAccount+':'+e.id} className="border-t border-zinc-100 even:bg-zinc-50">
      <td className="whitespace-nowrap px-3 py-2">{treasuryDateTime(e.businessDate,e.occurredAt)}</td>
      {bank&&<td className="px-3 py-2">{e.accountName}</td>}
      <td className="px-3 py-2"><button className="min-h-9 text-left font-semibold text-emerald-800 underline underline-offset-2" onClick={()=>setDetail(e)}>{displayReference(e)}</button></td>
      <td className="px-3 py-2">{e.description}{e.shiftId&&<p className="text-xs text-zinc-600">Shift {e.shiftId}</p>}</td>
      <td className="px-3 py-2">{label(e.branchId)}</td>
      <td className="px-3 py-2"><span className="whitespace-nowrap rounded-md bg-zinc-100 px-2 py-1 text-xs font-semibold">{movementLabel(e)}</span></td>
      <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-800">{e.direction==='inflow'?e.amountUGX.toLocaleString():'—'}</td>
      <td className="px-3 py-2 text-right font-semibold tabular-nums text-rose-800">{e.direction==='outflow'?e.amountUGX.toLocaleString():'—'}</td>
      {audit&&<><td className="break-all px-3 py-2">{e.id}</td><td className="break-all px-3 py-2">{e.actorId}</td></>}
      {showBalance&&<td className="px-3 py-2 text-right font-semibold tabular-nums">{e.runningBalanceUGX?.toLocaleString()??'Unavailable'}</td>}
     </tr>)}</tbody>
    </table>
   </div>
   <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
    <span>{filtered.length?((currentPage-1)*pageSize+1)+'–'+Math.min(currentPage*pageSize,filtered.length):'0'} of {filtered.length} transactions</span>
    <div className="flex flex-wrap items-center gap-2">
     <label>Rows per page <select className="rounded-lg border border-zinc-300 p-2" value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(1)}}>{[10,25,50].map(n=><option key={n}>{n}</option>)}</select></label>
     <button className="rounded-lg border px-3 py-2 disabled:opacity-40" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>Previous</button>
     <span>{currentPage} / {pages}</span>
     <button className="rounded-lg border px-3 py-2 disabled:opacity-40" disabled={currentPage===pages} onClick={()=>setPage(currentPage+1)}>Next</button>
    </div>
   </div>
   {!filtered.length&&<p className="py-5 text-center text-sm text-zinc-500">No posted movements match these filters.</p>}
  </>}
  <details><summary className="cursor-pointer py-2 text-sm font-semibold">Opening reconciliation references</summary>{ledgers.map(l=><p key={l.account.id} className="break-words py-1 text-xs text-zinc-600">{l.account.name}: UGX {l.openingBalanceUGX.toLocaleString()} · {l.reconciliationReference}</p>)}</details>
  {selected&&<section aria-label="Transaction details" className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm"><div className="flex items-center justify-between gap-3"><h4 className="font-semibold">Transaction details</h4><button className="min-h-11 px-3 underline" onClick={()=>setDetail(null)}>Close details</button></div>{[['Reference',displayReference(selected)],['Account',selected.accountId],['Source',selected.description],['Branch',label(selected.branchId)],['Shift',selected.shiftId||'Not recorded'],['EOD reconciliation',selected.eodReconciliationId||'Not applicable'],['Posting ID',selected.id],['Posted by',selected.actorId||'Not recorded']].map(([key,value])=><p key={key} className="break-words"><span className="font-medium">{key}: </span>{value}</p>)}</section>}
   </div>
   {aside}
  </div>
 </section>;
}
