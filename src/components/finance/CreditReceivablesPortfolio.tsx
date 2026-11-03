import {isActiveSale} from '../../utils/activeSales';
import React,{useEffect,useMemo,useState} from 'react';
import {collection,onSnapshot,query,where} from 'firebase/firestore';
import {db} from '../../firebase';
import {useAuth} from '../../contexts/AuthContext';
import {projectCreditReceivables,type CreditSourceRecord} from '../../domain/finance/creditReceivablesPortfolio';

export function useCreditReceivablesPortfolio(refreshKey=0){
 const {profile}=useAuth();const tenantId=profile?.tenantId||'';
 const [evidence,setEvidence]=useState<{tenantId:string;primary:CreditSourceRecord[]|null;secondary:CreditSourceRecord[]|null}>({tenantId:'',primary:null,secondary:null});
 const [state,setState]=useState<{tenantId:string;rows:CreditSourceRecord[];payments:CreditSourceRecord[];loaded:boolean;paymentsLoaded:boolean;error:string}>({tenantId:'',rows:[],payments:[],loaded:false,paymentsLoaded:false,error:''});
 useEffect(()=>{
  setState({tenantId,rows:[],payments:[],loaded:false,paymentsLoaded:false,error:''});if(!tenantId)return;
  const fail=()=>setState(s=>s.tenantId===tenantId?{...s,error:'Unable to load the receivables portfolio.'}:s);
  const unsubs=[onSnapshot(query(collection(db,'credit_receivables'),where('tenantId','==',tenantId)),snap=>setState(s=>s.tenantId===tenantId?{...s,rows:snap.docs.map(d=>({...d.data(),id:d.id})),loaded:true}:s),fail),
   onSnapshot(query(collection(db,'cashTransfers'),where('tenantId','==',tenantId)),snap=>setState(s=>s.tenantId===tenantId?{...s,payments:snap.docs.map(d=>({...d.data(),id:d.id})),paymentsLoaded:true}:s),fail)];
  return ()=>unsubs.forEach(fn=>fn());
 },[tenantId,refreshKey]);
 useEffect(()=>{
  setEvidence({tenantId,primary:null,secondary:null});if(!tenantId)return;
  const unsubs=(['paymentMethod','secondaryPaymentMethod'] as const).map((field,index)=>onSnapshot(query(collection(db,'sales'),where('tenantId','==',tenantId),where(field,'==','institutional_credit')),snap=>setEvidence(s=>s.tenantId===tenantId?{...s,[index===0?'primary':'secondary']:snap.docs.map(d=>({...d.data(),id:d.id}))}:s),()=>{}));
  return ()=>unsubs.forEach(fn=>fn());
 },[tenantId,refreshKey]);
 return useMemo(()=>{
  if(state.tenantId===tenantId&&state.error)return {loading:false,error:state.error,data:null,unlinkedCount:null};
  if(state.tenantId!==tenantId||!state.loaded||!state.paymentsLoaded)return {loading:true,error:'',data:null,unlinkedCount:null};
  if(state.error)return {loading:false,error:state.error,data:null};
  try{
   const linked=new Set(state.rows.flatMap(r=>[r.id,String(r.receipt_id||''),String(r.saleId||'')]).filter(Boolean));
   const unlinkedCount=evidence.tenantId===tenantId&&evidence.primary&&evidence.secondary
    ?new Set([...evidence.primary,...evidence.secondary].filter(r=>isActiveSale(r)&&!linked.has(r.id)).map(r=>r.id)).size:null;
   return {loading:false,error:'',data:projectCreditReceivables(tenantId,state.rows,state.payments),unlinkedCount};
  }
  catch(e){return {loading:false,error:e instanceof Error?e.message:'Receivables unavailable.',data:null};}
 },[state,tenantId,evidence]);
}
export function CreditReceivablesLedger({data,branches}:{data:ReturnType<typeof projectCreditReceivables>;branches:Array<{id:string;name:string}>}){
 const [branch,setBranch]=useState('all'),[client,setClient]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState('');
 const scope=data.rows.filter(r=>(branch==='all'||r.branchId===branch)&&(!client||(r.client+' '+r.reference).toLowerCase().includes(client.toLowerCase())));
 const inDates=(date:string)=>(!from||date>=from)&&(!to||(!!date&&date<=to));
 const rows=scope.filter(r=>inDates(r.businessDate));
 const ids=new Set(scope.map(r=>r.id));
 const payments=data.repayments.filter(p=>ids.has(p.receivableId)&&inDates(p.businessDate));
 const label=(id:string)=>branches.find(b=>b.id===id)?.name||id||'Unattributed';
 return <section aria-label="Credit receivables ledger" className="rounded-2xl border border-zinc-200 bg-white p-4 text-zinc-900 space-y-4">
  <h4 className="text-lg font-bold">Credit Receivables ledger</h4>
  <p className="text-sm text-zinc-600">Outstanding across all branches: UGX {data.totalOutstandingUGX.toLocaleString()}. Date filters select credit issue dates below and repayment dates in payment history.</p>
  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
   <select aria-label="Receivables branch" value={branch} onChange={e=>setBranch(e.target.value)} className="rounded-xl border border-zinc-200 bg-white p-3"><option value="all">All branches</option>{[...new Set(data.rows.map(r=>r.branchId))].map(id=><option key={id} value={id}>{label(id)}</option>)}</select>
   <input aria-label="Receivables customer or reference" placeholder="Customer, institution or invoice" value={client} onChange={e=>setClient(e.target.value)} className="rounded-xl border border-zinc-200 p-3"/>
   <input aria-label="Receivables from date" type="date" value={from} onChange={e=>setFrom(e.target.value)} className="rounded-xl border border-zinc-200 p-3"/>
   <input aria-label="Receivables to date" type="date" value={to} onChange={e=>setTo(e.target.value)} className="rounded-xl border border-zinc-200 p-3"/>
  </div>
  {from&&to&&from>to?<p role="alert">Choose an end date on or after the start date.</p>:<>
  <div className="overflow-x-auto"><table className="text-zinc-900 w-full text-left text-sm"><thead className="bg-zinc-50 text-zinc-700"><tr>{['Credit date','Reference','Customer / institution','Branch','Original credit UGX','Outstanding UGX','Status'].map(h=><th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody className="text-zinc-900">{rows.map(r=><tr key={r.id} className="border-t border-zinc-100"><td className="p-3">{r.businessDate||'Not recorded'}</td><td className="p-3">{r.reference}</td><td className="p-3">{r.client}</td><td className="p-3">{label(r.branchId)}</td><td className="p-3 tabular-nums">{r.originalUGX.toLocaleString()}</td><td className="p-3 tabular-nums font-bold">{r.outstandingUGX.toLocaleString()}</td><td className="p-3">{r.status}</td></tr>)}</tbody></table></div>
  {!rows.length&&<p>No saved receivables match these filters.</p>}
  <h5 className="font-bold">Recorded repayments</h5>
  <div className="overflow-x-auto"><table className="text-zinc-900 w-full text-left text-sm"><thead className="bg-zinc-50 text-zinc-700"><tr><th className="p-3">Date</th><th className="p-3">Payment reference</th><th className="p-3">Credit reference</th><th className="p-3">Repayment UGX</th></tr></thead><tbody className="text-zinc-900">{payments.map(p=><tr key={p.id} className="border-t border-zinc-100"><td className="p-3">{p.businessDate||'Not recorded'}</td><td className="p-3">{p.reference}</td><td className="p-3">{data.rows.find(r=>r.id===p.receivableId)?.reference}</td><td className="p-3 tabular-nums">{p.amountUGX.toLocaleString()}</td></tr>)}</tbody></table></div>
  {!payments.length&&<p>No linked repayment records match these filters.</p>}
  </>}
  <p className="text-xs text-zinc-500">Existing saved credit records determine the balance. Older repayments, adjustments and opening balances appear only where recorded; they are not reconstructed from the difference between original and outstanding amounts. Unlinked POS evidence and invoices are not added to this total.</p>
 </section>;
}
