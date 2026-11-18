import React,{useEffect,useRef,useState} from 'react';
import {collection,doc,getDocs,onSnapshot,query,where} from 'firebase/firestore';
import {db} from '../../firebase';
import {useAuth} from '../../contexts/AuthContext';
import {useManagementPaymentAccounts} from './ManagementPaymentAccounts';
import {PAYROLL_BATCHES,PAYROLL_PAYMENTS,employeePayrollStatus,payrollStatusLabels} from '../../domain/finance/payroll';
import {eligibleSupplierFunding} from '../../domain/finance/supplierPaymentPolicy';
import {getPayrollRevision,paySalary,reviewPayroll,type PayrollBatch} from '../../services/payrollFinanceService';
import type {FinancialPortfolio} from '../../domain/finance/financialPortfolio';
const ugx=(n:number)=>'UGX '+n.toLocaleString();
const field='mt-1 min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-slate-900';

export function PayrollReviewPanel({batchId,onChanged}:{batchId:string;onChanged:()=>void}){
  const {profile,hasPermission}=useAuth();
  const tenantId=profile?.tenantId || '';
  const [batch,setBatch]=useState<PayrollBatch>();
  const [rows,setRows]=useState<any[]>([]),[history,setHistory]=useState<any[]>([]),[events,setEvents]=useState<any[]>([]);
  const [registry,setRegistry]=useState<FinancialPortfolio[]>([]);
  const [reason,setReason]=useState(''),[staffId,setStaffId]=useState(''),[accountId,setAccountId]=useState('');
  const [amount,setAmount]=useState(''),[reference,setReference]=useState(''),[message,setMessage]=useState('');
  const [busy,setBusy]=useState(false),lock=useRef(false),requestId=useRef(crypto.randomUUID());
  const {accounts}=useManagementPaymentAccounts(true);
  const canOperate=hasPermission('finance','operate');
  useEffect(()=>{
    if(!tenantId)return;
    return onSnapshot(doc(db,PAYROLL_BATCHES,batchId),snapshot=>{
      const current=snapshot.data() as PayrollBatch;
      if(current?.tenantId!==tenantId){setMessage('Payroll is unavailable.');return;}
      setBatch({...current,id:snapshot.id});
    },()=>setMessage('Unable to load payroll.'));
  },[batchId,tenantId]);
  useEffect(()=>{
    if(!batch)return;
    let active=true;
    void Promise.all([getPayrollRevision(batch),getDocs(query(collection(db,'finance_portfolios_v1'),where('tenantId','==',tenantId)))]).then(([lines,portfolios])=>{
      if(active){setRows(lines);setRegistry(portfolios.docs.map(d=>d.data() as FinancialPortfolio));}
    }).catch(()=>{if(active)setMessage('Unable to verify the payroll detail or payment accounts.');});
    return ()=>{active=false;};
  },[batch?.revision,batchId,tenantId]);
  useEffect(()=>{
    if(!tenantId)return;
    const stopPayments=onSnapshot(query(collection(db,PAYROLL_PAYMENTS),where('tenantId','==',tenantId),where('batchId','==',batchId)),s=>setHistory(s.docs.map(d=>({...d.data(),id:d.id}))),()=>setMessage('Unable to load payment history.'));
    const stopEvents=onSnapshot(query(collection(db,'finance_payroll_events_v1'),where('tenantId','==',tenantId),where('batchId','==',batchId)),s=>setEvents(s.docs.map(d=>({...d.data(),id:d.id}))),()=>setMessage('Unable to load approval history.'));
    return ()=>{stopPayments();stopEvents();};
  },[batchId,tenantId]);
  const paid=(id:string)=>history.filter(p=>p.staffId===id).reduce((sum,p)=>sum+p.amountUGX,0);
  const selected=rows.find(r=>r.staffId===staffId);
  const eligible=accounts.filter(a=>eligibleSupplierFunding(a,tenantId,registry.find(p=>p.id===a.accountId))&&
    (a.scope?.kind!=='branch'||a.scope.branchId===selected?.branch_id));
  const run=async(action:()=>Promise<unknown>)=>{
    if(lock.current)return;lock.current=true;setBusy(true);setMessage('');
    try{await action();onChanged();}catch(e){setMessage(e instanceof Error?e.message:'Payroll action failed.');}
    finally{lock.current=false;setBusy(false);}
  };
  if(!batch)return <p role="status">{message||'Loading payroll…'}</p>;
  return <div className="min-w-0 space-y-4 text-sm text-slate-900">
    <div className="space-y-1"><h3 className="break-words text-lg font-bold">{batch.reference} · Revision {batch.revision}</h3>
      <p>{batch.periodStart} to {batch.periodEnd} · HR · {batch.employeeCount} employees</p>
      <p>Submitted by {batch.submittedByName} · {batch.submittedAt?.toDate?.().toLocaleString() || 'Submission incomplete'}</p>
      <p className="font-bold">{payrollStatusLabels[batch.status]}</p></div>
    <div className="grid grid-cols-1 gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-3">
      <p>Net salaries<br/><strong>{ugx(batch.totals.net)}</strong></p><p>Actual paid<br/><strong>{ugx(batch.paidUGX)}</strong></p><p>Outstanding<br/><strong>{ugx(batch.totals.net-batch.paidUGX)}</strong></p>
    </div>
    <p>Employer payroll expense: <strong>{ugx(batch.totals.gross+batch.totals.employerNssf)}</strong>. Gross earnings {ugx(batch.totals.gross)}; employer NSSF {ugx(batch.totals.employerNssf)}.</p>
    <p>Unremitted obligations at approval: PAYE {ugx(batch.totals.paye)}; NSSF {ugx(batch.totals.employeeNssf+batch.totals.employerNssf)}; other deductions {ugx(batch.totals.otherDeductions)}. Salary payments below settle net salaries only.</p>
    <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[850px] text-left text-xs"><thead className="bg-slate-50"><tr>{['Employee / ID','Branch','Verified hours / paid leave','Gross','Allowances','Deductions','Net salary','Paid / outstanding','Status'].map(label=><th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.id} className="border-t border-slate-100"><td className="min-w-40 whitespace-normal break-words p-3 font-semibold">{row.staff_name}<br/>{row.employee_id}</td><td className="p-3">{row.branch_id}</td><td className="p-3">{row.line.loggedHours.toFixed(2)} / {row.line.paidLeaveHours.toFixed(2)}</td><td className="p-3">{ugx(row.gross_salary)}</td><td className="p-3">{ugx(row.allowances)}</td><td className="p-3">{ugx(row.deductions)}</td><td className="p-3 font-bold">{ugx(row.net_salary)}</td><td className="p-3">{ugx(paid(row.staffId))}<br/>{ugx(row.net_salary-paid(row.staffId))}</td><td className="p-3">{payrollStatusLabels[employeePayrollStatus(batch.status,paid(row.staffId),row.net_salary)]}</td></tr>)}</tbody></table></div>
    {batch.returnReason&&<p className="rounded-xl bg-amber-50 p-3 text-amber-900">Return reason: {batch.returnReason}</p>}
    {canOperate&&batch.status==='pending_finance'&&<div className="space-y-3">
      <p>Approval recognizes the expense and salary liabilities. It does not disburse money.</p>
      <label className="block">Correction reason<textarea value={reason} onChange={e=>setReason(e.target.value)} className={field}/></label>
      <div className="flex flex-wrap gap-3"><button disabled={busy} onClick={()=>run(()=>reviewPayroll({tenantId,batchId,revision:batch.revision,actorId:profile!.uid,action:'approve'}))} className="min-h-11 rounded-xl bg-emerald-700 px-4 font-bold text-white disabled:opacity-50">Approve Payroll</button>
      <button disabled={busy||reason.trim().length<5} onClick={()=>run(()=>reviewPayroll({tenantId,batchId,revision:batch.revision,actorId:profile!.uid,action:'return',reason}))} className="min-h-11 rounded-xl border border-amber-400 bg-amber-50 px-4 font-bold text-amber-950 disabled:opacity-50">Return to HR</button></div>
    </div>}
    {canOperate&&['approved','partial'].includes(batch.status)&&batch.totals.net>batch.paidUGX&&<form className="space-y-3 rounded-xl border border-slate-200 p-3" onSubmit={e=>{
      e.preventDefault();void run(async()=>{await paySalary({tenantId,batchId,staffId,revision:batch.revision,actorId:profile!.uid,
        accountId,amountUGX:Number(amount),reference,requestId:requestId.current});setAmount('');setReference('');requestId.current=crypto.randomUUID();});
    }}><h4 className="font-bold">Record actual salary payment</h4>
      <label className="block">Employee<select required value={staffId} onChange={e=>{setStaffId(e.target.value);setAccountId('');setAmount('');}} className={field}><option value="">Select employee</option>{rows.filter(r=>r.net_salary>paid(r.staffId)).map(r=><option key={r.staffId} value={r.staffId}>{r.staff_name} · Outstanding {ugx(r.net_salary-paid(r.staffId))}</option>)}</select></label>
      <label className="block">Actual funding account<select required value={accountId} onChange={e=>setAccountId(e.target.value)} className={field}><option value="">Select account</option>{eligible.map(a=><option key={a.id} value={a.accountId}>{a.name} · Balance {ugx(a.balanceUGX)}</option>)}</select></label>
      <label className="block">Amount (whole UGX)<input required type="number" min="1" step="1" max={selected?selected.net_salary-paid(staffId):undefined} value={amount} onChange={e=>setAmount(e.target.value)} className={field}/></label>
      <label className="block">Actual payment reference<input required minLength={3} maxLength={120} value={reference} onChange={e=>setReference(e.target.value)} className={field}/></label>
      <button disabled={busy} className="min-h-11 w-full rounded-xl bg-emerald-700 px-4 font-bold text-white disabled:opacity-50">{busy?'Recording…':'Record salary payment'}</button>
    </form>}
    <details><summary className="min-h-11 cursor-pointer py-3 font-bold">Revision and approval history ({events.length})</summary><div className="space-y-2">{events.map(event=><p key={event.id} className="break-words">Revision {event.revision}: {event.action} · {event.actorId} · {event.recordedAt?.toDate?.().toLocaleString()} {event.reason&&' · '+event.reason}</p>)}</div></details>
    <details><summary className="min-h-11 cursor-pointer py-3 font-bold">Payment history ({history.length})</summary><div className="space-y-2">{history.map(payment=><p key={payment.id} className="break-words">{rows.find(r=>r.staffId===payment.staffId)?.staff_name} · {ugx(payment.amountUGX)} · {payment.accountName} · {payment.reference} · {payment.date} · Outstanding {ugx(payment.outstandingUGX)}</p>)}</div></details>
    {message&&<p role="alert" className="rounded-xl bg-amber-50 p-3 text-amber-950">{message}</p>}
  </div>;
}
