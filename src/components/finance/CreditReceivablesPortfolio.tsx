import { createPortal } from 'react-dom';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot, query, where, type Query, type DocumentData } from 'firebase/firestore';
import { CreditCard, ArrowDownLeft, Clock } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { ageingBuckets, inspectReceivables, receivableAgeing, receivableBalanceAt,
  type CreditSourceRecord, type PortfolioReceivable } from '../../domain/finance/creditReceivablesPortfolio';
import { CREDIT_METHODS } from '../../domain/finance/creditRecognition';
import { isReceivableDestination, RECEIVABLE_COLLECTION_SOURCE, RECEIVABLE_SETTLEMENTS } from '../../domain/finance/receivableSettlement';
import { listFinancialPortfolios } from '../../domain/finance/portfolioFirestore';
import type { FinancialPortfolio } from '../../domain/finance/financialPortfolio';
import { settleCreditReceivable } from '../../services/receivableSettlement';
import { kampalaBusinessDate } from '../../utils/eodBusinessDate';
import { sumEodAmounts } from '../../utils/eodMoney';
import { TreasuryLedgerExports } from './TreasuryLedgerExports';
import { TreasuryKpi, treasuryGrid } from './TreasuryPresentation';
import { useManagementPaymentAccounts } from './ManagementPaymentAccounts';

type BranchLabel = {id:string;name:string};
type RegisterData = ReturnType<typeof inspectReceivables>;
const money = (value:number) => 'UGX ' + value.toLocaleString();
const field = 'min-h-11 min-w-0 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2';
const button = 'min-h-11 rounded-xl border border-zinc-300 px-3 py-2 text-sm font-semibold disabled:opacity-50';
const label = (branches:BranchLabel[], branchId:string) => branches.find(branch => branch.id === branchId)?.name || branchId || 'Unattributed';
const add = (a:number, b:number) => sumEodAmounts([a,b]);

export function useCreditReceivablesPortfolio(refreshKey=0, branchId?:string, details=true) {
  const { profile } = useAuth();
  const tenantId = profile?.tenantId || '';
  const scope = JSON.stringify([tenantId, branchId, refreshKey, details]);
  const [state, setState] = useState<{scope:string;rows:Record<string,CreditSourceRecord[]>;failed:string[]}>({scope:'',rows:{},failed:[]});
  useEffect(() => {
    if (!tenantId) return;
    setState({scope,rows:{},failed:[]});
    const tenant = where('tenantId','==',tenantId);
    const branchScope = (name:string) => branchId ? [where(name,'==',branchId)] : [];
    const subscriptions = [
      ['records', query(collection(db,'credit_receivables'),tenant,...branchScope('branch_id'))],
    ] as const;
    const history = !details ? [] : [
      ['settlements', query(collection(db,RECEIVABLE_SETTLEMENTS),tenant,...branchScope('branchId'))],
      ['primary', query(collection(db,'sales'),tenant,...branchScope('branchId'),where('paymentMethod','in',CREDIT_METHODS))],
      ['secondary', query(collection(db,'sales'),tenant,...branchScope('branchId'),where('secondaryPaymentMethod','in',CREDIT_METHODS))],
      ['branches', query(collection(db,'branches'),tenant)]
    ] as const;
    const legacy = branchId || !details ? [] : [['legacy',query(collection(db,'cashTransfers'),tenant,where('fromPortfolio','==','receivables'))]] as const;
    const evidence = details && !branchId ? [
      ['cash', query(collection(db,'petty_cash_ledger'),tenant,where('source','==',RECEIVABLE_COLLECTION_SOURCE))],
      ['bank', query(collection(db,'banking_records'),tenant,where('source','==',RECEIVABLE_COLLECTION_SOURCE))],
      ['client', query(collection(db,'clients'),tenant)],
      ['institution', query(collection(db,'institutions'),tenant)]
    ] as const : [];
    const stop = [...subscriptions,...history,...legacy,...evidence].map(([key,ref]) => onSnapshot(ref as Query<DocumentData>, snap => {
      setState(old => old.scope === scope ? {...old,rows:{...old.rows,[key]:snap.docs.map(doc => ({...doc.data(),id:doc.id}))}} : old);
    }, () => setState(old => old.scope === scope ? {...old,failed:[...old.failed,key]} : old)));
    return () => stop.forEach(unsubscribe => unsubscribe());
  }, [tenantId, scope, branchId, details]);

  return useMemo(() => {
    const rows = state.rows;
    const branches:BranchLabel[] = (rows.branches || []).map(row => ({id:row.id,name:String(row.name||row.branch_name||row.branchName||row.id)}));
    if (state.scope !== scope) return {loading:true,error:'',data:null,branches};
    const evidenceError = state.failed.filter(key => key !== 'records');
    if (state.failed.includes('records')) return {loading:false,error:'Unable to load the authorized receivables register.',data:null,branches};
    if (!rows.records) return {loading:true,error:'',data:null,branches};
    try {
      const sales = [...new Map([...(rows.primary||[]),...(rows.secondary||[])].map(row => [row.id,row])).values()];
      const data = inspectReceivables(tenantId,rows.records,[...(rows.settlements||[]),...(rows.legacy||[])],sales,
        rows.cash && rows.bank ? [...rows.cash,...rows.bank] : undefined,
        rows.client && rows.institution ? {client:rows.client,institution:rows.institution} : undefined);
      const historyReady = !!rows.settlements && (!!branchId || !!rows.legacy);
      return {loading:false,error:'',data,branches,historyReady,evidenceError,
        evidencePending:!historyReady || !rows.primary || !rows.secondary || (details && !branchId && (!rows.cash||!rows.bank||!rows.client||!rows.institution))};
    } catch (error) {
      return {loading:false,error:error instanceof Error ? error.message : 'Receivables unavailable.',data:null,branches};
    }
  },[state,scope,tenantId,branchId,details]);
}

export function CreditReceivablesRegister({branchId,allowSettlement=false}:{branchId?:string;allowSettlement?:boolean}) {
  const { profile, hasPermission } = useAuth();
  const result = useCreditReceivablesPortfolio(0,branchId);
  if (result.error) return <p role="alert">{result.error}</p>;
  if (!result.data) return <p role="status">Loading receivables…</p>;
  return <CreditReceivablesLedger data={result.data} branches={result.branches} branchOnly={!!branchId}
    historyReady={!!result.historyReady} evidenceIncomplete={!!result.evidencePending || !!result.evidenceError?.length}
    allowSettlement={!!profile && allowSettlement && hasPermission('finance','operate')}/>;
}

function canCollectAtBranch(profile:NonNullable<ReturnType<typeof useAuth>['profile']>, branchId:string) {
  const roles = [profile.role,...(profile.secondaryRoles || [])];
  const assigned = [...(profile.assigned_branches||[]),profile.branch_id,profile.default_branch_id].filter(Boolean);
  return !!branchId && (assigned.includes(branchId) || !assigned.length ||
    roles.some(role => ['Finance Head','Accountant','admin','Admin','owner','Owner','CEO','ceo','CEO / MD','ceo / md'].includes(role)));
}

export function CreditReceivablesLedger({data,branches,allowSettlement=false,branchOnly=false,historyReady=true,evidenceIncomplete=false}:{
  data:RegisterData;branches:BranchLabel[];allowSettlement?:boolean;branchOnly?:boolean;historyReady?:boolean;evidenceIncomplete?:boolean;
}) {
  const { profile } = useAuth();
  const today = kampalaBusinessDate();
  const [branch,setBranch] = useState('all'), [search,setSearch] = useState(''), [status,setStatus] = useState('all');
  const [date,setDate] = useState(today), [from,setFrom] = useState(today.slice(0,7)+'-01');
  const [selected,setSelected] = useState(''), [page,setPage] = useState(0);
  useEffect(() => setPage(0), [branch, search, status, date]);
  const validPeriod = !!date && !!from && from <= date && date <= today;
  const scope = data.rows.filter(row => (branch==='all'||row.branchId===branch)
    && (row.client+' '+row.reference).toLowerCase().includes(search.trim().toLowerCase()));
  const rows = scope.filter(row => (!row.businessDate || row.businessDate <= date))
    .map(row => {
      const balance = date < today && (!historyReady || branchOnly) ? null : receivableBalanceAt(row,data.repayments,date,today);
      const ageing = balance ? receivableAgeing(row.dueDate,date) : '';
      const reportStatus = date >= today ? row.status : balance === null ? 'unverified' : balance === 0
        ? (row.reversalDate && row.reversalDate <= date ? 'reversed' : 'paid') : balance < row.originalUGX ? 'partial' : 'outstanding';
      return {...row,balance,ageing,reportStatus};
    }).filter(row => status==='all'||row.reportStatus===status)
    .sort((a,b) => b.businessDate.localeCompare(a.businessDate) || a.reference.localeCompare(b.reference));
  const ids = new Set(scope.map(row => row.id));
  const payments = data.repayments.filter(p => ids.has(p.receivableId) && p.businessDate >= from && p.businessDate <= date);
  const buckets = new Map<string,number>(ageingBuckets.map(bucket => [bucket,0]));
  const byBranch = new Map<string,number>(), byCustomer = new Map<string,{name:string;amount:number}>();
  let outstanding = 0;
  for (const row of rows) {
    if (!row.balance || !row.ageing) continue;
    outstanding = add(outstanding,row.balance);
    buckets.set(row.ageing,add(buckets.get(row.ageing)||0,row.balance));
    const branchName = label(branches,row.branchId);
    byBranch.set(branchName,add(byBranch.get(branchName)||0,row.balance));
    const key = row.debtorType+':'+(row.debtorId||row.id);
    byCustomer.set(key,{name:row.client,amount:add(byCustomer.get(key)?.amount||0,row.balance)});
  }
  const overdue = sumEodAmounts(ageingBuckets.slice(1,5).map(bucket => buckets.get(bucket)||0));
  const exceptions = data.exceptions.filter(exception => branch==='all'||!exception.branchId||exception.branchId===branch);
  const row = data.rows.find(item => item.id===selected);
  const exportRows = () => rows.map(item => ({
    'Reporting date':date,'Receipt or invoice':item.reference,Customer:item.client,Branch:label(branches,item.branchId),
    'Credit date':item.businessDate,'Due date':item.dueDate,'Original UGX':item.originalUGX,
    'Outstanding UGX':item.balance ?? 'Unverified',Ageing:item.ageing,Status:item.reportStatus
  }));
  return <section aria-label="Credit receivables ledger" className="rounded-2xl border border-zinc-200 bg-white p-4 text-zinc-900 space-y-4">
    <h4 className="text-lg font-bold">Credit Receivables</h4>
    <div className={treasuryGrid}>
      <TreasuryKpi title="Outstanding credit" value={validPeriod?money(outstanding):'Unavailable'} icon={CreditCard} note="Verified balances in this view"/>
      <TreasuryKpi title="Overdue credit" value={validPeriod?money(overdue):'Unavailable'} icon={Clock} tone="blue" note="Outstanding balances with a past due date"/>
      <TreasuryKpi title="Recorded collections" value={validPeriod&&historyReady?money(sumEodAmounts(payments.map(p=>p.amountUGX))):'Unavailable'} icon={ArrowDownLeft} note={branchOnly?'Posted collections for this branch':'Collections posted in the selected period'}/>
    </div>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 [&_label]:text-sm">
      {!branchOnly && <label>Branch<select className={field} value={branch} onChange={e=>setBranch(e.target.value)}><option value="all">All branches</option>
        {branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
      <label>Customer or invoice<input className={field} value={search} onChange={e=>setSearch(e.target.value)}/></label>
      <label>Status<select className={field} value={status} onChange={e=>setStatus(e.target.value)}>
        {['all','outstanding','partial','paid','reversed','defaulted'].map(value=><option key={value} value={value}>{value==='all'?'All statuses':value}</option>)}</select></label>
      <label>Collections from<input className={field} type="date" value={from} max={date} onChange={e=>setFrom(e.target.value)}/></label>
      <label>Reporting date<input className={field} type="date" value={date} min={branchOnly?today:undefined} max={today} onChange={e=>setDate(e.target.value)}/></label>
      <TreasuryLedgerExports filename={'receivables-ageing-'+date} disabled={!validPeriod||!rows.length} rows={exportRows}/>
    </div>
    {!validPeriod ? <p role="alert">Choose a valid collection period ending today or earlier.</p> : <>
      <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{[...buckets].map(([bucket,amount])=><div key={bucket} className="rounded-lg bg-zinc-50 p-2 text-sm"><dt>{bucket}</dt><dd className="font-semibold">{money(amount)}</dd></div>)}</dl>
      {rows.some(row=>row.balance===null) && <p role="status">Some historical balances could not be reconstructed from the available payment and correction history.</p>}
      <div className="overflow-x-auto"><table className="w-full text-left text-sm text-zinc-900">
        <thead className="bg-zinc-50 text-zinc-700"><tr>{['Receipt or invoice','Customer or institution','Branch','Original UGX','Outstanding UGX','Due date','Ageing','Status'].map(title=><th key={title} className="p-3 text-zinc-900">{title}</th>)}</tr></thead>
        <tbody className="text-zinc-900">{rows.slice(page*50,page*50+50).map(item=><tr key={item.id} className="border-t border-zinc-100">
          <td className="p-3 text-zinc-900"><button className="font-semibold text-emerald-800 underline" onClick={()=>setSelected(item.id)}>{item.reference}</button></td>
          <td className="p-3 text-zinc-900">{item.client}</td><td className="p-3 text-zinc-900">{label(branches,item.branchId)}</td>
          <td className="p-3 text-zinc-900">{item.originalUGX.toLocaleString()}</td><td className="p-3 font-semibold text-zinc-900">{item.balance?.toLocaleString()??'Unverified'}</td>
          <td className="p-3 text-zinc-900">{item.dueDate||'Terms missing'}</td><td className="p-3 text-zinc-900">{item.ageing}</td><td className="p-3 capitalize">{item.reportStatus}</td>
        </tr>)}</tbody></table></div>
      {!rows.length && <p>No saved receivables match these filters.</p>}
      {rows.length>50&&<div className="flex items-center justify-between">
        <button className={button} disabled={!page} onClick={()=>setPage(page-1)}>Previous</button><span>Page {page+1} of {Math.ceil(rows.length/50)}</span>
        <button className={button} disabled={(page+1)*50>=rows.length} onClick={()=>setPage(page+1)}>Next</button>
      </div>}
      <details className="rounded-lg border p-3"><summary className="cursor-pointer font-semibold">Outstanding by branch and customer</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <dl>{[...byBranch].map(([name,amount])=><div className="flex justify-between gap-2 text-sm" key={name}><dt>{name}</dt><dd>{money(amount)}</dd></div>)}</dl>
          <dl>{[...byCustomer].map(([key,value])=><div className="flex justify-between gap-2 text-sm" key={key}><dt>{value.name}</dt><dd>{money(value.amount)}</dd></div>)}</dl>
        </div>
      </details>
      {payments.length>0 && <details className="rounded-lg border p-3"><summary className="cursor-pointer font-semibold">Collections in this period</summary><ul className="mt-3 space-y-2 text-sm">
        {payments.map(payment=><li key={payment.id}>{payment.businessDate} · {payment.reference} · {payment.destination} · {money(payment.amountUGX)}</li>)}
      </ul></details>}
    </>}
    <details className="rounded-lg border p-3"><summary className="cursor-pointer font-semibold">Reconciliation exceptions ({exceptions.length})</summary>
      {evidenceIncomplete && <p className="mt-2 text-sm">Some reconciliation evidence is loading or unavailable.</p>}
      {!!exceptions.length && <><ul className="mt-2 space-y-2 text-sm">{exceptions.map(exception=><li key={exception.id}><strong>{exception.reference}</strong> · {label(branches,exception.branchId)} · {exception.detail}</li>)}</ul>
        <TreasuryLedgerExports filename="receivables-exceptions" disabled={false} rows={()=>exceptions.map(item=>({Reference:item.reference,Branch:label(branches,item.branchId),Issue:item.detail}))}/></>}
      {!exceptions.length && !evidenceIncomplete && <p className="mt-2 text-sm">No exceptions found in the available evidence.</p>}
    </details>
    {row && <ReceivableDetail key={row.id} row={row} branches={branches} payments={data.repayments.filter(p=>p.receivableId===row.id)}
      canSettle={!!profile && allowSettlement && row.canCollect && canCollectAtBranch(profile,row.branchId)} onClose={()=>setSelected('')}/>}
  </section>;
}

function ReceivableDetail({row,branches,payments,canSettle,onClose}:{
  key?:string;  row:PortfolioReceivable;branches:BranchLabel[];payments:RegisterData['repayments'];canSettle:boolean;onClose:()=>void;
}) {
  const { profile } = useAuth();
  const tenantId = profile?.tenantId || '';
  const [showForm,setShowForm] = useState(false);
  return createPortal(<div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-3">
    <section role="dialog" aria-modal="true" aria-labelledby="receivable-title" className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl bg-white p-4 text-zinc-900 shadow-xl sm:p-6">
      <button className={button+' float-right'} onClick={onClose}>Close</button>
      <h4 id="receivable-title" className="pr-20 text-lg font-bold">{row.reference}</h4>
      <p>{row.client} · {label(branches,row.branchId)}</p>
      <dl className="my-4 grid gap-2 sm:grid-cols-3 text-sm"><div><dt>Original credit</dt><dd className="font-semibold">{money(row.originalUGX)}</dd></div>
        <div><dt>Recorded collections</dt><dd className="font-semibold">{money(sumEodAmounts(payments.map(p=>p.amountUGX)))}</dd></div>
        <div><dt>Outstanding</dt><dd className="font-semibold">{money(row.outstandingUGX)}</dd></div></dl>
      {row.carriedUGX>0&&<p className="my-2 text-sm">Applied from the original receipt · {money(row.carriedUGX)}</p>}
      {row.refundDueUGX>0&&<p className="my-2 text-sm font-semibold text-amber-900">Refund obligation recorded · {money(row.refundDueUGX)}</p>}
      {payments.length>0 && <ul aria-label="Settlement history" className="my-3 space-y-2 text-sm">{payments.map(payment=><li key={payment.id}>{payment.businessDate || 'Date unavailable'} · {payment.destination} · {payment.reference} · {money(payment.amountUGX)}</li>)}</ul>}
      {showForm && profile ? <ReceivableSettlementForm row={row} branches={branches} tenantId={tenantId} actorId={profile.uid}/>
        : canSettle && <button className={button+' bg-emerald-800 text-white'} onClick={()=>setShowForm(true)}>Record collection</button>}
    </section>
  </div>,document.body);
}

export function ReceivableSettlementFields({destinations,amount,account,reference,error,busy,posted,onAmount,onAccount,onReference,onSubmit}:{
  destinations:Array<{id:string;label:string}>;amount:string;account:string;reference:string;error:string;busy:boolean;posted:boolean;
  onAmount:(v:string)=>void;onAccount:(v:string)=>void;onReference:(v:string)=>void;onSubmit:(e:React.FormEvent)=>void;
}) {
  const selected=destinations.find(destination=>destination.id===account);
  return <form className="grid gap-3 text-sm" onSubmit={onSubmit}>
    <label>Payment amount (UGX)<input className={field} type="number" min="1" step="1" required value={amount} onChange={e=>onAmount(e.target.value)} disabled={busy||posted}/></label>
    <label>Receiving account<select className={field} required value={account} onChange={e=>onAccount(e.target.value)} disabled={busy||posted}>
      <option value="">Select receiving account</option>{destinations.map(destination=><option key={destination.id} value={destination.id}>{destination.label}</option>)}
    </select></label>
    <label>Payment reference<input className={field} required minLength={3} maxLength={120} value={reference} onChange={e=>onReference(e.target.value)} disabled={busy||posted}/></label>
    {selected && Number(amount)>0 && <p className="rounded-lg bg-emerald-50 p-2">{money(Number(amount))} will be posted to {selected.label}.</p>}
    {error&&<p role="alert" className="text-red-800">{error}</p>}
    <button className={button+' bg-emerald-800 text-white'} disabled={busy||posted||!selected}>{busy?'Posting…':posted?'Collection recorded':'Confirm collection'}</button>
  </form>;
}

function ReceivableSettlementForm({row,tenantId,actorId,branches}:{
  row:PortfolioReceivable;tenantId:string;actorId:string;branches:BranchLabel[];
}) {
  const treasury = useManagementPaymentAccounts(true);
  const [portfolios,setPortfolios] = useState<FinancialPortfolio[]|null>(null);
  const [loadError,setLoadError] = useState('');
  const [amount,setAmount] = useState(''), [account,setAccount] = useState(''), [reference,setReference] = useState('');
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [posted,setPosted] = useState<number|null>(null);
  const busyRef = useRef(false);
  const intent = useRef({key:'',requestId:''});
  useEffect(() => {
    let active=true;
    listFinancialPortfolios(tenantId,row.branchId).then(rows=>{if(active)setPortfolios(rows);})
      .catch(()=>{if(active)setLoadError('Unable to verify eligible financial accounts.');});
    return ()=>{active=false;};
  },[tenantId,row.branchId]);
  const destinations = treasury.accounts.filter(account=>isReceivableDestination(account,tenantId,row.branchId,portfolios?.find(p=>p.id===account.accountId)))
    .map(account=>({id:account.accountId,label:account.name+' · '+(account.scope?.kind==='branch'?label(branches,account.scope.branchId):'Organisation')}));
  async function submit(event:React.FormEvent) {
    event.preventDefault();
    if (busyRef.current || posted!==null) return;
    const value=Number(amount);
    if (!Number.isSafeInteger(value)||value<=0||value>row.outstandingUGX) {
      setError('Enter a positive whole UGX amount within the outstanding balance.');return;
    }
    const key=JSON.stringify([tenantId,actorId,row.id,account,value,reference.trim().replace(/\s+/g,' ')]);
    if(intent.current.key!==key) {
      let requestId = '';
      try { requestId = sessionStorage.getItem('receivable:'+key) || ''; } catch {}
      requestId ||= crypto.randomUUID();
      try { sessionStorage.setItem('receivable:'+key,requestId); } catch {}
      intent.current = {key,requestId};
    }
    busyRef.current=true;setBusy(true);setError('');
    try {
      const result=await settleCreditReceivable({tenantId,actorId,receivableId:row.id,
        destinationAccountId:account,amountUGX:value,reference,requestId:intent.current.requestId});
      try { sessionStorage.removeItem('receivable:'+intent.current.key); } catch {}
      setPosted(result.remainingUGX);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to post the collection.');
    } finally { busyRef.current=false;setBusy(false); }
  }
  if (treasury.error || loadError) return <p role="alert">{treasury.error||loadError}</p>;
  if (treasury.loading || !portfolios) return <p role="status">Checking receiving accounts…</p>;
  if (!destinations.length) return <p role="status">No eligible initialized receiving accounts are available for this branch.</p>;
  return <><ReceivableSettlementFields {...{destinations,amount,account,reference,error,busy}} posted={posted!==null}
    onAmount={setAmount} onAccount={setAccount} onReference={setReference} onSubmit={submit}/>
    {posted!==null && <p role="status" className="my-2 font-semibold text-emerald-800">Collection recorded. Remaining balance {money(posted)}.</p>}</>;
}
