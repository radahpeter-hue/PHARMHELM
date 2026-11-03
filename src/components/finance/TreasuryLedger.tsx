import React,{useState} from 'react';
import type {AuthoritativePortfolioLedger} from '../../domain/finance/authoritativePortfolioLedger';
import {projectLedgerWithRunningBalances,type FinancialLedgerEntry} from '../../domain/finance/portfolioLedger';
import {summarizeBranchContributions} from '../../domain/finance/portfolioBranchContributions';
import {treasuryField} from './TreasuryAccountControls';
export function TreasuryLedger({ledgers,branches}:{ledgers:AuthoritativePortfolioLedger[];branches:Array<{id:string;name:string}>}){
 const [from,setFrom]=useState(''),[to,setTo]=useState(''),[direction,setDirection]=useState('all'),[branch,setBranch]=useState('all');
 const [detail,setDetail]=useState<FinancialLedgerEntry|null>(null);
 const opening=ledgers.reduce((s,l)=>s+l.openingBalanceUGX,0);
 const entries=projectLedgerWithRunningBalances(ledgers.flatMap(l=>l.entries),opening);
 const dated=entries.filter(e=>(!from||e.businessDate>=from)&&(!to||e.businessDate<=to));
 const filtered=dated.filter(e=>(direction==='all'||e.direction===direction)&&(branch==='all'||(branch==='unattributed'?!e.branchId:e.branchId===branch)));
 const label=(id?:string)=>branches.find(b=>b.id===id)?.name||id||'Unattributed';
 const contributions=summarizeBranchContributions(dated);
 return <section className="min-w-0 space-y-4 rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
  <div><h3 className="font-semibold">Authoritative account ledger</h3><p className="mt-1 text-xs text-zinc-600">Full account history determines balances. Filters only select movements shown below.</p></div>
  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
   <label className="text-sm">From date<input aria-label="Ledger from" type="date" value={from} onChange={e=>setFrom(e.target.value)} className={treasuryField}/></label>
   <label className="text-sm">To date<input aria-label="Ledger to" type="date" value={to} onChange={e=>setTo(e.target.value)} className={treasuryField}/></label>
   <label className="text-sm">Direction<select aria-label="Ledger direction" value={direction} onChange={e=>setDirection(e.target.value)} className={treasuryField}><option value="all">All movements</option><option value="inflow">Inflows</option><option value="outflow">Outflows</option></select></label>
   <label className="text-sm">Source branch<select aria-label="Filter ledger by source branch" value={branch} onChange={e=>setBranch(e.target.value)} className={treasuryField}><option value="all">All branches</option>{[...new Set(entries.flatMap(e=>e.branchId?[e.branchId]:[]))].map(id=><option key={id} value={id}>{label(id)}</option>)}<option value="unattributed">Unattributed / legacy</option></select></label>
  </div>
  {from&&to&&from>to?<p role="alert" className="text-sm text-red-800">Choose an end date on or after the start date.</p>:<>
   <details><summary className="cursor-pointer py-2 text-sm font-semibold">Branch contributions for selected dates</summary><p className="text-xs text-zinc-600">Posted inflows and net movement, not independent branch bank balances.</p><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-zinc-600"><tr><th className="p-3">Branch</th><th className="p-3">Inflows UGX</th><th className="p-3">Net UGX</th></tr></thead><tbody>{contributions.branches.filter(b=>branch==='all'||branch===b.branchId).map(b=><tr key={b.branchId}><td className="p-3">{label(b.branchId)}</td><td className="p-3">{b.inflowUGX.toLocaleString()}</td><td className="p-3">{b.netUGX.toLocaleString()}</td></tr>)}</tbody></table></div></details>
   <div className="overflow-x-auto rounded-xl border border-zinc-100"><table className="w-full text-left text-sm"><thead className="bg-zinc-50 text-zinc-600"><tr>{['Date / branch','Reference / shift','Inflow UGX','Outflow UGX','Balance UGX'].map(h=><th key={h} className="whitespace-nowrap p-3 font-medium">{h}</th>)}</tr></thead><tbody>{filtered.map(e=><tr key={e.id} className="border-t border-zinc-100"><td className="whitespace-nowrap p-3">{e.businessDate}<p className="text-xs text-zinc-500">{label(e.branchId)}</p></td><td className="p-3"><button className="min-h-11 text-left font-medium text-emerald-800 underline underline-offset-2" onClick={()=>setDetail(e)}>{e.reference}</button>{e.shiftId&&<p className="text-xs text-zinc-500">Shift: {e.shiftId}</p>}</td><td className="p-3 tabular-nums">{e.direction==='inflow'?e.amountUGX.toLocaleString():''}</td><td className="p-3 tabular-nums">{e.direction==='outflow'?e.amountUGX.toLocaleString():''}</td><td className="p-3 tabular-nums font-semibold">{e.runningBalanceUGX.toLocaleString()}</td></tr>)}</tbody></table></div>
   {!filtered.length&&<p className="py-5 text-center text-sm text-zinc-500">No posted movements match these filters.</p>}
  </>}
  <details><summary className="cursor-pointer py-2 text-sm font-semibold">Opening reconciliation references</summary>{ledgers.map(l=><p key={l.account.id} className="break-words py-1 text-xs text-zinc-600">{l.account.name}: UGX {l.openingBalanceUGX.toLocaleString()} · {l.reconciliationReference}</p>)}</details>
  {detail&&<section aria-label="Transaction details" className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm"><div className="flex items-center justify-between gap-3"><h4 className="font-semibold">Transaction details</h4><button className="min-h-11 px-3 underline" onClick={()=>setDetail(null)}>Close details</button></div>{[['Reference',detail.reference],['Account',detail.accountId],['Source',detail.description],['Branch',label(detail.branchId)],['Shift',detail.shiftId||'Not recorded'],['EOD reconciliation',detail.eodReconciliationId||'Not applicable'],['Posting ID',detail.id],['Posted by',detail.actorId||'Not recorded']].map(([key,value])=><p key={key} className="break-words"><span className="font-medium">{key}: </span>{value}</p>)}</section>}
 </section>;
}
