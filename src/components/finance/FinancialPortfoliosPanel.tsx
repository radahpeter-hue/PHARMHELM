import React,{useEffect,useMemo,useState} from 'react';
import {ArrowLeft,ArrowUpRight,Wallet,Smartphone,Landmark,CreditCard,Coins,Users,Plus,RefreshCw,ShieldCheck,AlertCircle,ArrowLeftRight,CalendarDays,ChevronRight} from 'lucide-react';
import {collection,getDocs,query,where} from 'firebase/firestore';
import {db} from '../../firebase';
import {useAuth} from '../../contexts/AuthContext';
import {hasAnyRole} from '../../utils/roles';
import {kampalaBusinessDate} from '../../utils/eodBusinessDate';
import type {ManagementPaymentAccount} from '../../services/managementCashPosting';
import {useManagementPaymentAccounts,ManagementPaymentAccounts} from './ManagementPaymentAccounts';
import {useCreditReceivablesPortfolio,CreditReceivablesLedger} from './CreditReceivablesPortfolio';
import {listFinancialPortfolios,createCustomFinancialPortfolio,registerPortfolioBankIdentity,registeredBankAccounts} from '../../domain/finance/portfolioFirestore';
import {defineBuiltInPortfolio} from '../../domain/finance/builtInPortfolios';
import type {FinancialPortfolio,FinancialPortfolioClassification} from '../../domain/finance/financialPortfolio';
import {loadAuthoritativePortfolioLedger,type AuthoritativePortfolioLedger} from '../../domain/finance/authoritativePortfolioLedger';
import {projectPortfolioBalances} from '../../domain/finance/portfolioWideView';
import {DEFAULT_TREASURY_PORTFOLIOS,treasuryPositions,verifiedLiquidPosition} from '../../domain/finance/treasuryOverview';
import {TreasuryLedger} from './TreasuryLedger';
import {TreasuryAccountControls,treasuryButton,treasuryField} from './TreasuryAccountControls';
import {TreasuryTransferAction} from './TreasuryTransfers';
import {TreasuryWelfareRecords} from './TreasuryWelfareRecords';

import {TreasuryKpi, treasuryDateTime, treasuryGrid} from './TreasuryPresentation';

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
 const treasury=useManagementPaymentAccounts(true);
 const [branches,setBranches]=useState<Array<{id:string;name:string}>>([]),[items,setItems]=useState<FinancialPortfolio[]>([]);
 const [registryError,setRegistryError]=useState(''),[registryLoading,setRegistryLoading]=useState(true),[refresh,setRefresh]=useState(0);
 const credit=useCreditReceivablesPortfolio(refresh);
 const [bankTab,setBankTab]=useState('Unified Ledger');
 const [activityDate,setActivityDate]=useState('');
 const [entryId,setEntryId]=useState('');
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
 const selectedAccount=treasury.accounts.find(a=>a.tenantId===tenantId&&a.accountId===(accountId||customPortfolio?.id));
 const workspaceAccounts=accountId?treasury.accounts.filter(a=>a.accountId===accountId):current?.accounts||treasury.accounts.filter(a=>a.accountId===customPortfolio?.id);
 const ids=new Set(workspaceAccounts.map(a=>a.accountId));
 const workspaceLedgers=ledgers.filter(l=>ids.has(l.account.accountId));
 const ledgerPending=ledgerLoading||ledgerRevision!==treasury.accounts;
 const ledgerComplete=workspaceAccounts.length>0&&workspaceAccounts.every(a=>workspaceLedgers.some(l=>l.account.accountId===a.accountId));
 const heading=accountId?(selectedPortfolio?.name||selectedAccount?.name||accountId):(workspace==='bank'?'Bank Portfolio':current?.name)||customPortfolio?.name||'Global Treasury Overview';
 const open=(id:string)=>{setWorkspace(id);setAccountId('');setCreateOpen(false);setBankTab('Unified Ledger');setEntryId('');};
 const positionText=(id:string,balance:number|null)=>loading?'Loading…':error?'Balance unavailable':id==='credit'?credit.loading?'Loading…':credit.error?'Balance unavailable':'UGX '+credit.data!.totalOutstandingUGX.toLocaleString():id==='welfare'?'Balance unavailable':money(balance);
 const positions=model.positions.length?model.positions:DEFAULT_TREASURY_PORTFOLIOS.map(p=>({...p,balanceUGX:null,accounts:[],reason:''}));
 const statusFor=(id:string,balance:number|null)=>{
  if(loading||(id==='credit'&&credit.loading))return 'Loading';
  if(error)return 'Unavailable';
  if(id==='credit')return credit.data?'Non-cash receivables':'Unavailable';
  if(id==='welfare')return 'Balance unavailable';
  return balance===null?'Reconciliation required':'Verified';
 };
 const statuses=positions.map(p=>statusFor(p.id,p.balanceUGX));
 const pending=statuses.filter(s=>s==='Reconciliation required').length;
 const today=kampalaBusinessDate();
 const activity=ledgers.flatMap(l=>l.entries.map(e=>{
  const portfolio=positions.find(p=>p.accounts.some(a=>a.accountId===l.account.accountId));
  return {...e,accountName:portfolio?.name||l.account.name,workspaceId:portfolio?.id||l.account.portfolioId||''};
 })).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)||b.id.localeCompare(a.id));
 const recent=activity.filter(e=>!activityDate||e.businessDate===activityDate).slice(0,5);
 const movementTotal=activity.reduce((sum,e)=>sum+(e.businessDate===today?e.amountUGX:0),0);
 const movementVerified=!loading&&!error&&!ledgerPending&&!ledgerError&&model.liquid?.complete&&model.views.every(v=>v.balanceUGX!==null);
 const bankRoot=workspace==='bank'&&!accountId;
 const positionBalance=current?.balanceUGX??model.views.find(v=>v.portfolioId===workspace)?.balanceUGX??null;
 const ledgerBalance=loading?'Loading…':error?'Unavailable':accountId?
   (selectedAccount?.initialized&&Number.isSafeInteger(selectedAccount.balanceUGX)&&selectedAccount.reconciliationReference?money(selectedAccount.balanceUGX):'Opening reconciliation required'):
   money(positionBalance);
 const bankDirectory=<section className={surface+' space-y-4 '+(bankTab==='Unified Ledger'?'order-last self-start':'')}><h3 className="font-semibold">Bank Accounts</h3><p className="text-sm text-zinc-500">{bankTab==='Reconciliations'?'Review opening reconciliation evidence for registered accounts.':'Open a registered account to inspect its ledger or reconcile its opening balance.'}</p><div className={bankTab==='Unified Ledger'?'grid gap-3':'grid gap-3 sm:grid-cols-2'}>{bankAccounts.map(bank=>{const a=treasury.accounts.find(a=>a.accountId===bank.id);return <button key={bank.id} onClick={()=>setAccountId(bank.id)} className="min-w-0 rounded-xl border border-zinc-200 p-4 text-left hover:border-emerald-600"><p className="font-semibold">{bank.name}</p><p className="mt-1 break-words text-xs text-zinc-500">{bank.bankInstitution} · {bank.bankAccountReference?'•••• '+(bank.bankAccountReference.length>4?bank.bankAccountReference.slice(-4):''):'Reference unavailable'} · {bank.status}</p><p className="mt-3 font-semibold">{a?.initialized&&Number.isSafeInteger(a.balanceUGX)&&a.reconciliationReference?money(a.balanceUGX):'Opening reconciliation required'}</p>
     {bankTab==='Reconciliations'&&a?.reconciliationReference&&<p className="break-words text-xs text-zinc-600">Opening evidence: {a.reconciliationReference}</p>}<p className="mt-2 text-xs text-emerald-800">Open account and ledger</p></button>;})}{treasury.accounts.filter(a=>a.accountId==='management_bank').map(a=><button key={a.id} onClick={()=>setAccountId(a.accountId)} className="rounded-xl border border-zinc-200 p-4 text-left"><p className="font-semibold">{a.name}</p><p className="text-xs text-zinc-500">Legacy Management Bank reserve</p><p className="mt-3 font-semibold">{a.initialized?money(a.balanceUGX):'Opening reconciliation required'}</p></button>)}</div>{!bankAccounts.length&&<p className="text-sm text-zinc-500">No individual bank accounts registered.</p>}{canRegister&&bankTab==='Account Management'&&<details open><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">Register bank account</summary><TreasuryRegistration bank tenantId={tenantId} actorId={profile!.uid} onChanged={changed}/></details>}</section>;
 const TitleIcon=icons[workspace as keyof typeof icons]||Coins;
 return <section className="@container min-w-0 space-y-5 text-zinc-900" aria-label="Global Treasury">
  {workspace&&<nav aria-label="Treasury navigation" className="flex flex-wrap items-center gap-2 text-sm">
   <button onClick={()=>open('')} className="flex min-h-10 items-center gap-2 font-medium text-emerald-800"><ArrowLeft size={16}/>Global Treasury Overview</button>
   {workspace==='bank'&&<><ChevronRight size={14}/><button onClick={()=>{setAccountId('');setBankTab('Unified Ledger');setEntryId('')}} className="min-h-10 text-emerald-800">Bank Portfolio</button>{accountId&&<><ChevronRight size={14}/><span>Bank Accounts</span></>}</>}
  </nav>}
  <header className="flex flex-wrap items-start justify-between gap-3">
   <div className="flex min-w-0 items-start gap-3"><span className="rounded-xl bg-emerald-100 p-3 text-emerald-800"><TitleIcon size={26}/></span><div className="min-w-0">
    <h2 className="break-words text-2xl font-bold tracking-tight sm:text-3xl">{heading}</h2>
    <p className="mt-1 text-sm text-zinc-600">{workspace?(current?.context||'Account balances, reconciliations and posted financial movements.'):'Consolidated financial position across branches and portfolios.'}</p>
   </div></div>
   <div className="flex flex-wrap items-end gap-2">
    {!workspace&&<label className="text-xs font-medium"><CalendarDays size={14} className="mr-1 inline"/>Activity date<input type="date" value={activityDate} onChange={e=>setActivityDate(e.target.value)} className={treasuryField}/></label>}
    {workspace&&!accountId&&hasPermission('finance','operate')&&<div key={workspace}><TreasuryTransferAction
     tenantId={tenantId} actorId={profile!.uid} allowedBranches={canRegister?null:[...(profile!.assigned_branches||[]),profile!.branch_id||'',profile!.default_branch_id||'']}
     accounts={treasury.accounts} portfolios={items} sourceAccountIds={workspaceAccounts.map(a=>a.accountId)}
     sourcePortfolioName={current?.name||customPortfolio?.name||heading} bank={bankRoot} loading={loading} unavailable={!!error} supportsTransfers={!['credit','welfare'].includes(workspace)&&customPortfolio?.allowsTransfersOut!==false} onChanged={changed}/></div>}
    <button onClick={changed} aria-label="Refresh treasury" className="flex min-h-11 items-center gap-2 rounded-xl border border-emerald-700 bg-white px-3 text-sm font-semibold text-emerald-800"><RefreshCw size={15}/>Refresh</button>
   </div>
  </header>
  {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
  {!workspace?<>
   <div className={treasuryGrid}>
    <TreasuryKpi title={model.liquid&&!model.liquid.complete?'Verified liquid cash (partial)':'Verified Liquid Cash'} value={loading?'Loading…':error||!model.liquid?.verifiedCount?'Unavailable':money(model.liquid.balanceUGX)} icon={Wallet} note={`${model.liquid?.verifiedCount||0} of 5 liquid categories reconciled`}/>
    <TreasuryKpi title="Credit Receivables" value={positionText('credit',null)} icon={CreditCard} tone="amber" note="Outstanding customer credit"/>
    <TreasuryKpi title="Pending Reconciliation" value={loading?'Loading…':error?'Unavailable':String(pending)} icon={AlertCircle} tone="red" note="Default portfolios requiring action"/>
    <TreasuryKpi title="Today’s Movements" value={ledgerPending&&!error?'Loading…':movementVerified&&Number.isSafeInteger(movementTotal)?money(movementTotal):'Unavailable'} icon={ArrowLeftRight} tone="blue" note="Gross inflows and outflows, including transfers"/>
   </div>
   <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-semibold">Financial Portfolios (7)</h3>{canRegister&&<button onClick={()=>setCreateOpen(v=>!v)} className="flex min-h-11 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-medium"><Plus size={16}/>{createOpen?'Close registration':'Add custom portfolio'}</button>}</div>
   <div className={treasuryGrid+' auto-rows-fr'} aria-label="Default financial portfolios">
    {positions.map(p=>{
     const Icon=icons[p.id as keyof typeof icons];
     const status=statusFor(p.id,p.balanceUGX);
     const value=positionText(p.id,p.balanceUGX);
     return <button key={p.id} onClick={()=>open(p.id)} className="group flex min-h-36 min-w-0 items-start gap-3 rounded-xl border border-zinc-200 bg-white p-4 text-left shadow-sm hover:border-emerald-600 focus-visible:outline-2 focus-visible:outline-emerald-700">
      <span className="shrink-0 rounded-lg bg-emerald-50 p-2.5 text-emerald-800"><Icon size={21}/></span>
      <div className="min-w-0 grow"><h4 className="font-bold">{p.name}</h4><p className="mt-1 text-xs text-zinc-600">{p.context}</p>
       {value!==status&&<p className="mt-2 break-words text-lg font-bold tabular-nums">{value}</p>}
       <span className={`mt-2 inline-block rounded-md px-2 py-1 text-xs font-semibold ${status==='Verified'?'bg-emerald-100 text-emerald-900':status==='Reconciliation required'?'bg-amber-100 text-amber-900':'bg-zinc-100 text-zinc-800'}`}>{status}</span>
      </div><ArrowUpRight size={16} className="shrink-0 text-zinc-500 group-hover:text-emerald-700"/>
     </button>;
    })}
   </div>
   {createOpen&&canRegister&&<TreasuryRegistration tenantId={tenantId} actorId={profile!.uid} onChanged={changed}/>}
   {model.custom.length>0&&<section className="space-y-3"><h3 className="font-semibold">Additional portfolios</h3><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{model.custom.map(p=><button key={p.id} onClick={()=>open(p.id)} className={surface+' text-left hover:border-emerald-600'}><p className="font-semibold">{p.name}</p><p className="mt-2 text-xl font-semibold">{loading?'Loading…':error?'Balance unavailable':money(model.views.find(v=>v.portfolioId===p.id)?.balanceUGX??null)}</p><p className="mt-2 text-xs text-zinc-500">{p.classification.replaceAll('_',' ')} · {p.status} · Open portfolio</p></button>)}</div></section>}
   <div className="grid gap-4 @min-[920px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
    <section className={surface}>
     <h3 className="text-lg font-bold">Recent Financial Activity</h3>
     {ledgerError&&<p role="alert" className="mt-2 text-sm text-amber-900">Some ledger histories could not be verified. {ledgerError}</p>}
     <div tabIndex={0} aria-label="Scrollable recent activity" className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[590px] text-left text-sm text-zinc-900"><thead className="bg-zinc-100"><tr>{['Date & time','Portfolio','Transaction','Branch','Amount'].map(h=><th key={h} scope="col" className="whitespace-nowrap p-2 last:text-right">{h}</th>)}</tr></thead>
       <tbody>{!ledgerPending&&recent.map(e=><tr key={e.accountId+':'+e.id} className="border-b border-zinc-100">
        <td className="whitespace-nowrap p-2">{treasuryDateTime(e.businessDate,e.occurredAt)}</td>
        <td className="p-2">{e.accountName}</td><td className="p-2">{e.workspaceId?<button className="text-left font-medium text-emerald-800 underline" onClick={()=>{open(e.workspaceId);setEntryId(e.id);if(e.workspaceId==='bank')setAccountId(e.accountId||'')}}>{e.description}</button>:e.description}</td>
        <td className="p-2">{branches.find(b=>b.id===e.branchId)?.name||e.branchId||'Unattributed'}</td>
        <td className={`whitespace-nowrap p-2 text-right font-semibold tabular-nums ${e.direction==='inflow'?'text-emerald-800':'text-rose-800'}`}>{e.direction==='inflow'?'+':'−'} {money(e.amountUGX)}</td>
       </tr>)}</tbody>
      </table>
     </div>
     {(ledgerPending||!recent.length)&&<p className="mt-3 text-sm text-zinc-600">{error?'Activity unavailable':ledgerPending?'Loading ledger movements…':'No verified movements for this selection.'}</p>}
    </section>
    <section className={surface}><h3 className="text-lg font-bold">Reconciliation Status</h3>
     <p className="mt-1 text-sm text-zinc-600">Seven default portfolios</p>
     <dl className="mt-3 divide-y divide-zinc-100">{['Verified','Reconciliation required','Unavailable','Non-cash receivables'].map((status,i)=><div key={status} className="flex items-center justify-between gap-2 py-3 text-sm"><dt className="flex items-center gap-2"><span className={`size-2.5 rounded-full ${['bg-emerald-600','bg-amber-500','bg-zinc-400','bg-sky-600'][i]}`}/>{status}</dt><dd className="font-bold">{loading?'…':statuses.filter(s=>s===status||(status==='Unavailable'&&s==='Balance unavailable')).length}</dd></div>)}</dl>
    </section>
   </div>
  </>:<>
   {workspace==='credit'?<>{credit.error?<p role="alert">{credit.error}</p>:credit.data?<CreditReceivablesLedger data={credit.data} branches={branches}/>:<p>Loading receivables…</p>}<p className="text-xs text-zinc-600">{credit.unlinkedCount==null?'POS credit linkage check unavailable or loading.':credit.unlinkedCount>0?`${credit.unlinkedCount} POS credit receipt(s) have no saved receivable and require reconciliation in the Credit Ledger.`:'No unmatched POS credit receipts found.'}</p></>:workspace==='welfare'?<div key={'welfare-'+refresh}><TreasuryWelfareRecords tenantId={tenantId}/></div>:<>
    {bankRoot&&<nav aria-label="Bank portfolio views" className="flex flex-wrap gap-2 border-b border-zinc-200">
     {['Unified Ledger','Bank Accounts',...(canRegister?['Account Management']:[]),'Reconciliations','Audit Trail'].map(tab=><button key={tab} aria-pressed={bankTab===tab} onClick={()=>setBankTab(tab)} className={`min-h-11 border-b-2 px-3 text-sm font-semibold ${bankTab===tab?'border-emerald-700 text-emerald-800':'border-transparent text-zinc-600'}`}>{tab}</button>)}
    </nav>}
    {bankRoot&&canRegister&&bankTab==='Unified Ledger'&&<button onClick={()=>setBankTab('Account Management')} className="rounded-lg border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-800"><Plus size={16} className="mr-1 inline"/>Register bank account</button>}
    {bankRoot&&current?.balanceUGX===null&&<p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{current.reason}</p>}
    <div className="space-y-4">
    {bankRoot&&(bankTab!=='Unified Ledger'&&bankTab!=='Audit Trail'||!workspaceLedgers.length)&&bankDirectory}
    {['cash','petty'].includes(workspace)&&!accountId&&<details open={!ledgerComplete} className={surface+' space-y-3'}><summary className="cursor-pointer font-semibold">Branch accounts and opening reconciliation</summary><div className="grid gap-3 sm:grid-cols-2">{branches.map(b=>{const id=(workspace==='cash'?'system_branch_cash_sales_':'system_petty_cash_')+b.id;const a=treasury.accounts.find(a=>a.accountId===id);return <button key={b.id} onClick={()=>setAccountId(id)} className="rounded-xl border border-zinc-200 p-4 text-left hover:border-emerald-600"><p className="font-semibold">{b.name}</p><p className="mt-2 text-sm">{a?.initialized?money(a.balanceUGX):'Opening reconciliation required'}</p></button>;})}{workspace==='petty'&&treasury.accounts.filter(a=>a.accountId==='management_petty_cash').map(a=><button key={a.id} onClick={()=>setAccountId(a.accountId)} className="rounded-xl border border-zinc-200 p-4 text-left"><p className="font-semibold">{a.name}</p><p className="mt-2 text-sm">{a.initialized?money(a.balanceUGX):'Opening reconciliation required'}</p></button>)}</div>{workspace==='petty'&&canRegister&&<ManagementPaymentAccounts allowedKinds={['petty_cash']}/>}</details>}
    {accountId&&workspace!=='bank'&&<button onClick={()=>{setAccountId('');setEntryId('')}} className="min-h-11 text-sm font-medium text-emerald-800">Back to {current?.name||'portfolio'}</button>}
    {(!bankRoot||bankTab==='Unified Ledger'||bankTab==='Audit Trail')&&(
     error?<p className={surface+' text-sm text-amber-900'}>Ledger unavailable until account coverage can be verified.</p>:
     ledgerPending?<p className={surface}>Loading posted movements…</p>:
     workspaceLedgers.length?<div key={workspace+'|'+accountId+'|'+entryId}><TreasuryLedger ledgers={workspaceLedgers} branches={branches} bank={bankRoot} accountCount={bankAccounts.length} balance={ledgerBalance} initialReference={entryId} partial={!ledgerComplete||(!accountId&&positionBalance===null)} audit={bankRoot&&bankTab==='Audit Trail'} aside={bankRoot&&bankTab==='Unified Ledger'?bankDirectory:undefined}/></div>:
     <section className={surface}><h3 className="font-bold">{bankRoot?'Unified Ledger':'Account ledger'}</h3><p className="my-2 text-lg font-semibold">{ledgerBalance}</p><p role="status" className="text-sm text-amber-900">{ledgerError||'No verified ledger available. Select the affected account and complete its opening reconciliation.'}</p></section>
    )}
    </div>
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
