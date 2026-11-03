import React,{useEffect,useMemo,useState} from 'react';
import {ArrowLeft,ArrowUpRight,Wallet,Smartphone,Landmark,CreditCard,Coins,Users,Plus,RefreshCw,ShieldCheck,AlertCircle} from 'lucide-react';
import {collection,getDocs,query,where} from 'firebase/firestore';
import {db} from '../../firebase';
import {useAuth} from '../../contexts/AuthContext';
import {hasAnyRole} from '../../utils/roles';
import type {ManagementPaymentAccount} from '../../services/managementCashPosting';
import {useManagementPaymentAccounts,ManagementPaymentAccounts} from './ManagementPaymentAccounts';
import {useCreditReceivablesPortfolio,CreditReceivablesLedger} from './CreditReceivablesPortfolio';
import {listFinancialPortfolios,createCustomFinancialPortfolio,registerPortfolioBankIdentity,registeredBankAccounts} from '../../domain/finance/portfolioFirestore';
import {defineBuiltInPortfolio} from '../../domain/finance/builtInPortfolios';
import type {FinancialPortfolio,FinancialPortfolioClassification} from '../../domain/finance/financialPortfolio';
import {loadAuthoritativePortfolioLedger,type AuthoritativePortfolioLedger} from '../../domain/finance/authoritativePortfolioLedger';
import {projectPortfolioBalances} from '../../domain/finance/portfolioWideView';
import {treasuryPositions,verifiedLiquidPosition} from '../../domain/finance/treasuryOverview';
import {TreasuryLedger} from './TreasuryLedger';
import {TreasuryAccountControls,treasuryButton,treasuryField} from './TreasuryAccountControls';
import {TreasuryWelfareRecords} from './TreasuryWelfareRecords';

const icons={cash:Wallet,airtel:Smartphone,mtn:Smartphone,bank:Landmark,credit:CreditCard,petty:Coins,welfare:Users};
const money=(value:number|null)=>value===null?'Reconciliation required':'UGX '+value.toLocaleString();
const surface='min-w-0 rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5';
export function FinancialPortfoliosPanel(){
 const {profile,hasPermission}=useAuth();
 if(!profile?.tenantId||!hasPermission('finance','view'))return <p role="alert" className={surface+' text-zinc-900'}>Finance access is required.</p>;
 return <TreasuryWorkspace key={profile.tenantId}/>;
}
function TreasuryWorkspace(){
 const {profile,hasPermission}=useAuth();const tenantId=profile!.tenantId;
 const canRegister=hasPermission('finance','operate')&&hasAnyRole(profile,['owner','CEO','CEO / MD']);
 const treasury=useManagementPaymentAccounts(true),credit=useCreditReceivablesPortfolio();
 const [branches,setBranches]=useState<Array<{id:string;name:string}>>([]),[items,setItems]=useState<FinancialPortfolio[]>([]);
 const [registryError,setRegistryError]=useState(''),[registryLoading,setRegistryLoading]=useState(true),[refresh,setRefresh]=useState(0);
 const [workspace,setWorkspace]=useState(''),[accountId,setAccountId]=useState(''),[createOpen,setCreateOpen]=useState(false);
 const [ledgers,setLedgers]=useState<AuthoritativePortfolioLedger[]>([]),[ledgerError,setLedgerError]=useState(''),[ledgerLoading,setLedgerLoading]=useState(true);
 const [ledgerRevision,setLedgerRevision]=useState<unknown>(null);
 const changed=()=>setRefresh(n=>n+1);
 useEffect(()=>{let live=true;setRegistryLoading(true);setRegistryError('');
  Promise.all([getDocs(query(collection(db,'branches'),where('tenantId','==',tenantId))),listFinancialPortfolios(tenantId)])
   .then(([rows,portfolios])=>{if(live){setBranches(rows.docs.map(d=>({id:d.id,name:String(d.data().name||d.id)})));setItems(portfolios);}})
   .catch(()=>{if(live)setRegistryError('Unable to load branch or portfolio coverage. Refresh to retry. Consolidated balances are unavailable.');})
   .finally(()=>{if(live)setRegistryLoading(false);});return()=>{live=false;};
 },[tenantId,refresh]);
 const model=useMemo(()=>{try{
  const positions=treasuryPositions({tenantId,branches,portfolios:items,accounts:treasury.accounts});
  const custom=items.filter(p=>p.origin==='custom'&&!p.bankParentId);
  const views=projectPortfolioBalances(custom,treasury.accounts);
  return {positions,liquid:verifiedLiquidPosition(positions),custom,views,error:''};
 }catch(e){return {positions:[],liquid:null,custom:[],views:[],error:e instanceof Error?e.message:'Treasury balances unavailable.'};}},[tenantId,branches,items,treasury.accounts]);
 const error=treasury.error||registryError||model.error;
 const loading=treasury.loading||registryLoading;
 useEffect(()=>{let live=true;setLedgers([]);setLedgerError('');setLedgerLoading(true);setLedgerRevision(null);
  if(loading||error)return()=>{live=false;};
  const accounts=treasury.accounts.filter(a=>a.initialized&&a.tenantId===tenantId);
  Promise.allSettled(accounts.map(a=>loadAuthoritativePortfolioLedger(a,{from:'1900-01-01',to:'9999-12-31',direction:'all'})))
   .then(results=>{if(!live)return;setLedgers(results.flatMap(r=>r.status==='fulfilled'?[r.value]:[]));const failed=results.flatMap((r,i)=>r.status==='rejected'?[accounts[i].name+': '+(r.reason instanceof Error?r.reason.message:'Ledger unavailable')]:[]);setLedgerError(failed.join(' '));setLedgerRevision(treasury.accounts);setLedgerLoading(false);});
  return()=>{live=false;};
 },[tenantId,treasury.accounts,loading,error,refresh]);
 const bankAccounts=registeredBankAccounts(items);
 const current=model.positions.find(p=>p.id===workspace);
 const customPortfolio=model.custom.find(p=>p.id===workspace);
 const selectedPortfolio=items.find(p=>p.id===accountId)||customPortfolio;
 const selectedAccount=treasury.accounts.find(a=>a.accountId===(accountId||customPortfolio?.id));
 const workspaceAccounts=accountId?treasury.accounts.filter(a=>a.accountId===accountId):current?.accounts||treasury.accounts.filter(a=>a.accountId===customPortfolio?.id);
 const ids=new Set(workspaceAccounts.map(a=>a.accountId));
 const workspaceLedgers=ledgers.filter(l=>ids.has(l.account.accountId));
 const ledgerPending=ledgerLoading||ledgerRevision!==treasury.accounts;
 const ledgerComplete=workspaceAccounts.length>0&&workspaceAccounts.every(a=>workspaceLedgers.some(l=>l.account.accountId===a.accountId));
 const heading=accountId?(selectedPortfolio?.name||selectedAccount?.name||accountId):current?.name||customPortfolio?.name||'Global Treasury Overview';
 const open=(id:string)=>{setWorkspace(id);setAccountId('');setCreateOpen(false);};
 const positionText=(id:string,balance:number|null)=>loading?'Loading…':error?'Balance unavailable':id==='credit'?credit.loading?'Loading…':credit.error?'Balance unavailable':'UGX '+credit.data!.totalOutstandingUGX.toLocaleString():id==='welfare'?'Balance unavailable':money(balance);
 const recent=ledgers.flatMap(l=>l.entries.map(e=>({...e,accountName:l.account.name}))).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)||b.id.localeCompare(a.id)).slice(0,5);
 return <section className="min-w-0 space-y-5 text-zinc-900" aria-label="Global Treasury">
  {workspace&&<nav aria-label="Treasury navigation" className="flex flex-wrap items-center gap-2 text-sm"><button onClick={()=>open('')} className="flex min-h-11 items-center gap-2 font-medium text-emerald-800"><ArrowLeft size={16}/>Global Treasury Overview</button>{workspace==='bank'&&<><span className="text-zinc-400">/</span><button onClick={()=>setAccountId('')} className="min-h-11 text-emerald-800">Bank Portfolio</button><span className="text-zinc-400">/</span><span>Bank Accounts</span></>}</nav>}
  <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="mb-1 text-xs font-semibold uppercase tracking-wider text-emerald-800">Cash & Banking</p><h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{heading}</h2><p className="mt-2 max-w-2xl text-sm text-zinc-500">{workspace?'Account balances, reconciliations and posted financial movements.':'Your consolidated financial position across branches. Balances reflect reconciled accounts.'}</p></div><button onClick={changed} aria-label="Refresh treasury" className="flex min-h-11 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-sm"><RefreshCw size={15}/>Refresh</button></header>
  {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
  {!workspace?<>
   <div className="grid gap-3 lg:grid-cols-3">
    <div className={surface+' lg:col-span-2'}><div className="flex items-center gap-2 text-sm font-medium text-zinc-600"><ShieldCheck size={17} className="text-emerald-700"/>Verified liquid cash {model.liquid&&!model.liquid.complete&&'(partial)'}</div><p className="mt-3 break-words text-3xl font-semibold tracking-tight">{loading?'Loading…':error||!model.liquid?.verifiedCount?'Unavailable':'UGX '+model.liquid.balanceUGX.toLocaleString()}</p><p className="mt-2 text-xs text-zinc-500">{model.liquid?.verifiedCount||0} of 5 liquid categories reconciled. Credit, welfare and custom funds are excluded.</p></div>
    <div className={surface}><p className="text-sm text-zinc-600">Credit outstanding</p><p className="mt-3 break-words text-2xl font-semibold">{positionText('credit',null)}</p><p className="mt-2 text-xs text-zinc-500">Receivables are money owed and are excluded from liquid cash.</p></div>
   </div>
   {!loading&&!error&&model.liquid&&!model.liquid.complete&&<p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertCircle size={18} className="shrink-0"/>Some portfolio openings require reconciliation. Open the affected portfolio to review its accounts.</p>}
   <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-semibold">Financial portfolios</h3>{canRegister&&<button onClick={()=>setCreateOpen(v=>!v)} className="flex min-h-11 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-medium"><Plus size={16}/>{createOpen?'Close registration':'Add custom portfolio'}</button>}</div>
   <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Default financial portfolios">
    {(model.positions.length?model.positions:[{id:'cash',name:'Branch Cash Sales'},{id:'airtel',name:'Airtel Money'},{id:'mtn',name:'MTN Money'},{id:'bank',name:'Bank'},{id:'credit',name:'Credit Receivables'},{id:'petty',name:'Petty Cash'},{id:'welfare',name:'Staff Welfare Fund'}].map(p=>({...p,context:'Balance unavailable',balanceUGX:null,reason:'',accounts:[]}))).map(p=>{const Icon=icons[p.id as keyof typeof icons];return <button key={p.id} onClick={()=>open(p.id)} className="group min-w-0 rounded-2xl border border-zinc-200 bg-white p-5 text-left shadow-sm transition hover:border-emerald-600 hover:shadow-md focus-visible:outline-2 focus-visible:outline-emerald-700">
     <div className="flex items-start justify-between gap-2"><span className="rounded-xl bg-emerald-50 p-2.5 text-emerald-800"><Icon size={20}/></span><ArrowUpRight size={17} className="text-zinc-400 group-hover:text-emerald-700"/></div><h4 className="mt-4 font-semibold">{p.name}</h4><p className="mt-2 break-words text-xl font-semibold tabular-nums">{positionText(p.id,p.balanceUGX)}</p><p className="mt-2 text-xs text-zinc-500">{p.context}</p><p className="mt-4 text-xs font-medium text-zinc-600">{loading?'Loading account coverage':error?'Data unavailable':p.id==='credit'?'Non-cash position':p.id==='welfare'?'Reserve reconciliation required':p.balanceUGX===null?'Opening reconciliation required':'Reconciled'} <span aria-hidden="true">·</span> Open portfolio</p>
    </button>;})}
   </div>
   {createOpen&&canRegister&&<TreasuryRegistration tenantId={tenantId} actorId={profile!.uid} onChanged={changed}/>}
   {model.custom.length>0&&<section className="space-y-3"><h3 className="font-semibold">Additional portfolios</h3><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{model.custom.map(p=><button key={p.id} onClick={()=>open(p.id)} className={surface+' text-left hover:border-emerald-600'}><p className="font-semibold">{p.name}</p><p className="mt-2 text-xl font-semibold">{loading?'Loading…':error?'Balance unavailable':money(model.views.find(v=>v.portfolioId===p.id)?.balanceUGX??null)}</p><p className="mt-2 text-xs text-zinc-500">{p.classification.replaceAll('_',' ')} · {p.status} · Open portfolio</p></button>)}</div></section>}
   <section className={surface}><h3 className="font-semibold">Recent posted activity</h3>{ledgerPending?<p className="mt-3 text-sm text-zinc-500">Loading ledger movements…</p>:<>{ledgerError&&<p role="alert" className="mt-2 break-words text-sm text-amber-900">Some ledger histories could not be verified. {ledgerError}</p>}{recent.map(e=><div key={e.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 py-3 last:border-0"><div className="min-w-0"><p className="break-words text-sm font-medium">{e.reference}</p><p className="text-xs text-zinc-500">{e.businessDate} · {e.accountName} · {branches.find(b=>b.id===e.branchId)?.name||e.branchId||'Unattributed'}{e.shiftId?' · '+e.shiftId:''}</p></div><span className="text-sm font-semibold tabular-nums">{e.direction==='inflow'?'+':'−'} UGX {e.amountUGX.toLocaleString()}</span></div>)}{!recent.length&&<p className="mt-4 text-sm text-zinc-500">No verified ledger movements are available.</p>}</>}</section>
  </>:<>
   {workspace==='credit'?<>{credit.error?<p role="alert">{credit.error}</p>:credit.data?<CreditReceivablesLedger data={credit.data} branches={branches}/>:<p>Loading receivables…</p>}<p className="text-xs text-zinc-600">{credit.unlinkedCount==null?'POS credit linkage check unavailable or loading.':credit.unlinkedCount>0?`${credit.unlinkedCount} POS credit receipt(s) have no saved receivable and require reconciliation in the Credit Ledger.`:'No unmatched POS credit receipts found.'}</p></>:workspace==='welfare'?<TreasuryWelfareRecords tenantId={tenantId}/>:<>
    <section className={surface}><p className="text-sm text-zinc-500">{accountId?'Account balance':workspace==='bank'?'Consolidated bank position':'Portfolio position'}</p><p className="mt-2 break-words text-2xl font-semibold">{loading?'Loading…':error?'Balance unavailable':accountId?selectedAccount?.initialized?money(selectedAccount.balanceUGX):'Opening reconciliation required':money(current?.balanceUGX??model.views.find(v=>v.portfolioId===workspace)?.balanceUGX??null)}</p>{!accountId&&current?.reason&&<p className="mt-3 text-sm text-amber-900">{current.reason}</p>}<p className="mt-2 text-xs text-zinc-500">Current account position. Date and branch filters do not change this balance.</p></section>
    {workspace==='bank'&&!accountId&&<section className={surface+' space-y-4'}><h3 className="font-semibold">Bank Accounts</h3><p className="text-sm text-zinc-500">Open a registered account to inspect its ledger or reconcile its opening balance.</p><div className="grid gap-3 sm:grid-cols-2">{bankAccounts.map(bank=>{const a=treasury.accounts.find(a=>a.accountId===bank.id);return <button key={bank.id} onClick={()=>setAccountId(bank.id)} className="min-w-0 rounded-xl border border-zinc-200 p-4 text-left hover:border-emerald-600"><p className="font-semibold">{bank.name}</p><p className="mt-1 break-words text-xs text-zinc-500">{bank.bankInstitution} · {bank.bankAccountReference} · {bank.status}</p><p className="mt-3 font-semibold">{a?.initialized?money(a.balanceUGX):'Opening reconciliation required'}</p><p className="mt-2 text-xs text-emerald-800">Open account and ledger</p></button>;})}{treasury.accounts.filter(a=>a.accountId==='management_bank').map(a=><button key={a.id} onClick={()=>setAccountId(a.accountId)} className="rounded-xl border border-zinc-200 p-4 text-left"><p className="font-semibold">{a.name}</p><p className="text-xs text-zinc-500">Legacy Management Bank reserve</p><p className="mt-3 font-semibold">{a.initialized?money(a.balanceUGX):'Opening reconciliation required'}</p></button>)}</div>{!bankAccounts.length&&<p className="text-sm text-zinc-500">No individual bank accounts registered.</p>}{canRegister&&<details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">Register bank account</summary><TreasuryRegistration bank tenantId={tenantId} actorId={profile!.uid} onChanged={changed}/></details>}</section>}
    {['cash','petty'].includes(workspace)&&!accountId&&<section className={surface+' space-y-3'}><h3 className="font-semibold">Branch accounts</h3><div className="grid gap-3 sm:grid-cols-2">{branches.map(b=>{const id=(workspace==='cash'?'system_branch_cash_sales_':'system_petty_cash_')+b.id;const a=treasury.accounts.find(a=>a.accountId===id);return <button key={b.id} onClick={()=>setAccountId(id)} className="rounded-xl border border-zinc-200 p-4 text-left hover:border-emerald-600"><p className="font-semibold">{b.name}</p><p className="mt-2 text-sm">{a?.initialized?money(a.balanceUGX):'Opening reconciliation required'}</p></button>;})}{workspace==='petty'&&treasury.accounts.filter(a=>a.accountId==='management_petty_cash').map(a=><button key={a.id} onClick={()=>setAccountId(a.accountId)} className="rounded-xl border border-zinc-200 p-4 text-left"><p className="font-semibold">{a.name}</p><p className="mt-2 text-sm">{a.initialized?money(a.balanceUGX):'Opening reconciliation required'}</p></button>)}</div>{workspace==='petty'&&canRegister&&<ManagementPaymentAccounts allowedKinds={['petty_cash']}/>}</section>}
    {accountId&&workspace!=='bank'&&<button onClick={()=>setAccountId('')} className="min-h-11 text-sm font-medium text-emerald-800">Back to {current?.name||'portfolio'}</button>}
    {ledgerPending?<p className={surface}>Loading posted movements…</p>:ledgerComplete&&!(workspace==='bank'&&!accountId&&current?.balanceUGX===null)?<div key={workspace+'|'+accountId}><TreasuryLedger ledgers={workspaceLedgers} branches={branches}/></div>:<p role="status" className={surface+' text-sm text-amber-900'}>{ledgerError||'No verified ledger available. Select the affected account and complete its opening reconciliation.'}</p>}
    {canRegister&&!error&&!loading&&<AccountActions workspace={workspace} accountId={accountId} selectedPortfolio={selectedPortfolio} account={selectedAccount} accounts={treasury.accounts} tenantId={tenantId} actorId={profile!.uid} branches={branches} onChanged={changed}/>}
   </>}
  </>}
 </section>;
}
function AccountActions({workspace,accountId,selectedPortfolio,account,accounts,tenantId,actorId,branches,onChanged}:{workspace:string;accountId:string;selectedPortfolio?:FinancialPortfolio;account?:ManagementPaymentAccount;accounts:ManagementPaymentAccount[];tenantId:string;actorId:string;branches:Array<{id:string;name:string}>;onChanged:()=>void}){
 let portfolio:FinancialPortfolio|undefined=selectedPortfolio;
 if(!portfolio){const branch=branches.find(b=>accountId===(workspace==='cash'?'system_branch_cash_sales_':'system_petty_cash_')+b.id);const key=branch?(workspace==='cash'?'branch_cash_sales':'petty_cash'):workspace==='mtn'?'mtn_mobile_money':workspace==='airtel'?'airtel_mobile_money':null;
  if(key)portfolio=defineBuiltInPortfolio({tenantId,key,branchId:branch?.id,createdBy:actorId,createdAt:'2026-01-01T00:00:00Z'});
 }
 if(account&&(accountId==='management_bank'||accountId==='management_petty_cash'))return <div key={accountId}><TreasuryAccountControls transferOnly portfolio={defineBuiltInPortfolio({tenantId,key:'bank',createdBy:actorId,createdAt:'2026-01-01T00:00:00Z'})} account={account} accounts={accounts} actorId={actorId} onChanged={onChanged}/></div>;
 const effective=account||accounts.find(a=>a.accountId===portfolio?.id);
 return portfolio?<div key={portfolio.id}><TreasuryAccountControls portfolio={portfolio} account={effective} accounts={accounts} actorId={actorId} onChanged={onChanged}/></div>:null;
}
function TreasuryRegistration({bank=false,tenantId,actorId,onChanged}:{bank?:boolean;tenantId:string;actorId:string;onChanged:()=>void}){
 const [name,setName]=useState(''),[classification,setClassification]=useState<FinancialPortfolioClassification>('restricted_internal_fund');
 const [institution,setInstitution]=useState(''),[reference,setReference]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function submit(e:React.FormEvent){e.preventDefault();if(busy)return;setBusy(true);setMessage('');try{
  if(bank)await registerPortfolioBankIdentity({tenantId,actorId,institution,accountReference:reference,displayName:name,createdAt:new Date().toISOString()});
  else await createCustomFinancialPortfolio({id:'custom_'+crypto.randomUUID().replaceAll('-',''),tenantId,name,classification,description:'CEO-registered financial portfolio',scope:{kind:'organisation'},currency:'UGX',origin:'custom',supportsChildAccounts:false,allowsTransfersIn:true,allowsTransfersOut:true,createdBy:actorId,createdAt:new Date().toISOString()});
  setName('');setInstitution('');setReference('');setMessage('Registered. Open the account to confirm its verified opening reconciliation.');onChanged();
 }catch(e){setMessage(e instanceof Error?e.message:'Registration failed.');}finally{setBusy(false);}}
 return <form onSubmit={submit} className={surface+' grid gap-3 sm:grid-cols-2'}><h4 className="font-semibold sm:col-span-2">{bank?'Bank account registration':'Custom portfolio registration'}</h4><label className="text-sm">{bank?'Account name':'Portfolio name'}<input required maxLength={120} value={name} onChange={e=>setName(e.target.value)} className={treasuryField}/></label>{bank?<><label className="text-sm">Bank institution<input required maxLength={100} value={institution} onChange={e=>setInstitution(e.target.value)} className={treasuryField}/></label><label className="text-sm">Bank account reference<input required maxLength={60} value={reference} onChange={e=>setReference(e.target.value)} className={treasuryField}/></label></>:<label className="text-sm">Portfolio classification<select value={classification} onChange={e=>setClassification(e.target.value as FinancialPortfolioClassification)} className={treasuryField}><option value="restricted_internal_fund">Internal fund</option><option value="other_financial_asset">Other financial asset</option><option value="cash_equivalent">Cash equivalent</option></select></label>}<p className="text-xs text-zinc-500 sm:col-span-2">Organisation scope. Registration establishes identity only; no funds are added.</p><button disabled={busy} className={treasuryButton}>{busy?'Registering…':bank?'Register bank account':'Create portfolio'}</button>{message&&<p role="status" className="break-words text-sm sm:col-span-2">{message}</p>}</form>;
}
