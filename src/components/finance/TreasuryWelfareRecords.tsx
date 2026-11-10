import {TreasuryLedgerExports} from './TreasuryLedgerExports';
import {Users, List} from 'lucide-react';
import {TreasuryKpi, treasuryGrid} from './TreasuryPresentation';
import React,{useEffect,useState} from 'react';
import {collection,getDocs,query,where} from 'firebase/firestore';
import {db} from '../../firebase';
import {belongsToManagementPettyCash} from '../../services/managementCashPosting';
import {treasuryField} from './TreasuryAccountControls';
type WelfareHistory={id:string;source:string;reference:string;date:string;amount:number|null;type:string;status:string};
/** Recorded allocations and benefits are evidence, not a verified spendable reserve. */
export function TreasuryWelfareRecords({tenantId}:{tenantId:string}){
 const [rows,setRows]=useState<WelfareHistory[]|null>(null),[error,setError]=useState('');
 const [funding,setFunding]=useState<WelfareHistory[]|null>(null);
 const [from,setFrom]=useState(''),[to,setTo]=useState(''),[kind,setKind]=useState('all');
 useEffect(()=>{let live=true;setRows(null);setError('');Promise.all(['welfareAllocations','welfare'].map(async source=>{
  const snapshot=await getDocs(query(collection(db,source),where('tenantId','==',tenantId)));
  return snapshot.docs.map(d=>{const r=d.data();const raw=r.date||r.createdAt||r.created_at;const date=typeof raw==='string'?raw.slice(0,10):raw?.toDate instanceof Function?raw.toDate().toISOString().slice(0,10):'';
   return {id:source+'/'+d.id,source,reference:String(r.reference_number||r.notes||r.saleId||d.id),date,amount:Number.isSafeInteger(r.amount)&&r.amount>=0?r.amount:null,status:String(r.status||''),type:source==='welfareAllocations'?'Funding allocation record':String(r.type||'Welfare benefit record')};});
 })).then(results=>{if(live)setRows(results.flat().sort((a,b)=>b.date.localeCompare(a.date)));}).catch(()=>{if(live)setError('Welfare funding and expenditure history is unavailable. Refresh this portfolio to retry.');});return()=>{live=false;};},[tenantId]);
 useEffect(()=>{
  let live=true;
  setFunding(null);
  getDocs(query(collection(db,'petty_cash_ledger'),where('tenantId','==',tenantId)))
   .then(snapshot=>{
    const withdrawals=snapshot.docs.flatMap(doc=>{
     const row=doc.data();
     if(row.category!=='Staff Welfare'||row.type!=='withdrawal'||!belongsToManagementPettyCash(tenantId,row))return [];
     return [{id:'petty_cash_ledger/'+doc.id,source:'petty_cash_ledger',date:typeof row.date==='string'?row.date.slice(0,10):'',
      reference:String(row.reference_number||doc.id),type:'Recorded Management Cash withdrawal',status:'',
      amount:Number.isSafeInteger(row.amount)&&row.amount>=0?row.amount:null}];
    });
    if(live)setFunding(withdrawals);
   }).catch(()=>{if(live)setFunding(null);});
  return ()=>{live=false;};
 },[tenantId]);
 const benefits=rows?.filter(row=>row.source==='welfare'&&['approved','completed'].includes(row.status));
 const historicalNet=funding&&benefits&&funding.length>0&&[...funding,...benefits].every(row=>row.amount!==null)
  ?funding.reduce((sum,row)=>sum+row.amount!,0)-benefits.reduce((sum,row)=>sum+row.amount!,0):null;
 const visible=[...(rows||[]),...(funding||[])].sort((a,b)=>b.date.localeCompare(a.date)).filter(r=>(!from||r.date>=from)&&(!to||(!!r.date&&r.date<=to))&&(kind==='all'||kind===r.source));
 return <section className="min-w-0 space-y-4 rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
  <h3 className="font-semibold">Staff Welfare Fund records</h3><div className={treasuryGrid}>
   <TreasuryKpi title="Spendable reserve" value="Balance unavailable" icon={Users} tone="amber"/>
   <TreasuryKpi title="Historical ledger estimate" value={historicalNet!==null&&Number.isSafeInteger(historicalNet)?'UGX '+historicalNet.toLocaleString():'Unavailable'}
    icon={List} note="Recorded Management Cash withdrawals less approved or completed benefits, across all dates"/>
   <TreasuryKpi title="Matching welfare records" value={error||!rows||(from&&to&&from>to)?'Unavailable':String(visible.length)} icon={List} tone="blue" note="Recorded allocations and benefits"/>
  </div><p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Reserve reconciliation required. Saved funding allocations and benefit expenditure do not establish a spendable cash balance. EOD welfare declarations are excluded.</p>
  <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">From date<input type="date" value={from} onChange={e=>setFrom(e.target.value)} className={treasuryField}/></label><label className="text-sm">To date<input type="date" value={to} onChange={e=>setTo(e.target.value)} className={treasuryField}/></label>
   <label className="text-sm">Movement<select className={treasuryField} value={kind} onChange={e=>setKind(e.target.value)}><option value="all">All records</option><option value="petty_cash_ledger">Management Cash withdrawals</option><option value="welfareAllocations">Funding allocations</option><option value="welfare">Benefit expenditure</option></select></label>
   <TreasuryLedgerExports filename="welfare-ledger" disabled={!!error||!visible.length||!!(from&&to&&from>to)}
    rows={()=>visible.map(r=>({Date:r.date,Reference:r.reference,Type:r.type,Status:r.status,'Recorded UGX':r.amount??'Unverified amount'}))}/>
  </div>
  {error?<p role="alert" className="text-sm text-red-800">{error}</p>:rows===null?<p className="text-sm">Loading saved records…</p>:from&&to&&from>to?<p role="alert">Choose a valid date range.</p>:<><div className="overflow-x-auto"><table className="w-full text-left text-sm text-zinc-900"><thead className="bg-zinc-50 text-zinc-600"><tr>{['Date','Record / reference','Type','Recorded UGX'].map(h=><th key={h} className="p-3">{h}</th>)}</tr></thead><tbody className="text-zinc-900">{visible.map(r=><tr key={r.id} className="border-t border-zinc-100"><td className="whitespace-nowrap p-3">{r.date||'Not recorded'}</td><td className="p-3">{r.reference}<p className="text-xs text-zinc-500">{r.id}</p></td><td className="p-3">{r.type}</td><td className="p-3 tabular-nums">{r.amount===null?'Unverified amount':r.amount.toLocaleString()}</td></tr>)}</tbody></table></div>{!visible.length&&<p className="py-4 text-sm text-zinc-500">No recorded funding or benefit expenditure matches these dates.</p>}</>}
 </section>;
}
