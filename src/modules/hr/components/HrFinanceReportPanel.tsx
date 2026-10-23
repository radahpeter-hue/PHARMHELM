import React,{useState} from 'react';
import {loadHrFinanceEvidence} from '../../../services/hrFinanceReportLoader';
import {reconcileHrFinance} from '../../../services/hrFinanceReconciliation';
import {getDateKeyForTimezone} from '../../../services/consumptionService';
import {toSafeCsv} from '../../../utils/csv';
export function HrFinanceReportPanel({profile,activeBranchId}:{profile:any;activeBranchId?:string|null}) {
 const branches=[...new Set<string>([...(profile.assigned_branches||[]),profile.branch_id,profile.default_branch_id,activeBranchId].filter(Boolean))];
 const [branch,setBranch]=useState(activeBranchId||branches[0]||''),[date,setDate]=useState(getDateKeyForTimezone(new Date()));
 const [period,setPeriod]=useState(''),[employee,setEmployee]=useState('');
 const [report,setReport]=useState<ReturnType<typeof reconcileHrFinance>|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const load=async()=>{setBusy(true);setError('');setReport(null);try{setReport(reconcileHrFinance(await loadHrFinanceEvidence(profile.tenantId,branch==='all'?branches:[branch]),date));}catch(e){setError(e instanceof Error?e.message:'Reconciliation evidence could not be verified.');}finally{setBusy(false);}};
 const selected=report?.payrollRows.filter(r=>(!period||r.period===period)&&(!employee||r.staffId===employee))||[];
 const csv=(name:string,data:Record<string,any>[])=>{
  if(!data.length)return;const keys=Object.keys(data[0]),blob=new Blob(['\uFEFF'+toSafeCsv([keys,...data.map(r=>keys.map(k=>r[k]))])],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name+'.csv';a.click();URL.revokeObjectURL(url);
 };
 const labels:Record<string,string>={grossUGX:'Gross remuneration',salaryExpenseUGX:'Salary expense',employerNssfUGX:'Employer NSSF obligation',payeUGX:'PAYE payable',employeeNssfUGX:'Employee NSSF obligation',otherDeductionsUGX:'Other deduction payables',netSalaryUGX:'Recognized net salary',salaryPaidUGX:'Verified salary payments',salaryOutstandingUGX:'Outstanding salary payable',overdueSalaryUGX:'Overdue salary payable',advanceDisbursedUGX:'Advances disbursed',advanceRecoveredUGX:'Advance recoveries, net of reversals',advanceOutstandingUGX:'Outstanding advance receivables',welfareExpenseUGX:'Recognized welfare expense',welfarePaidUGX:'Welfare payments',welfareOutstandingUGX:'Welfare payable',chargesUGX:'External charge expenses'};
 return <details className="border bg-white p-4 rounded-xl"><summary className="font-bold cursor-pointer">Payroll, welfare and account reconciliation</summary>
  <p className="text-sm my-3">Current verified positions across the selected branches. Expenses and liabilities are separate from cash payments. The review date identifies overdue salaries with an HR-approved due date.</p>
  <div className="grid sm:grid-cols-3 gap-3"><label>Reconciliation branch<select className="border rounded p-2 w-full" value={branch} onChange={e=>{setBranch(e.target.value);setReport(null);}}>{branches.map(id=><option key={id}>{id}</option>)}<option value="all">All assigned branches</option></select></label><label>Due-date review date<input className="border rounded p-2 w-full" type="date" value={date} onChange={e=>{setDate(e.target.value);setReport(null);}}/></label><button disabled={busy||!branch} onClick={load}>{busy?'Verifying evidence…':'Load and reconcile'}</button></div>
  {error&&<p role="alert" className="text-rose-700 mt-3">{error}</p>}
  {report&&<div className="space-y-4 mt-4">
   <p role="status">{report.exceptions.length?`${report.exceptions.length} reconciliation exceptions require review.`:'No unexplained differences in the loaded evidence.'}</p>
   {report.dueDateUnspecified>0&&<p className="text-amber-700">{report.dueDateUnspecified} unpaid payroll records have no approved due date. Their overdue status is unverified.</p>}
   <div className="grid sm:grid-cols-3 gap-3">{Object.entries(report.totals).map(([key,value])=><p key={key} className="border p-3 rounded text-sm">{labels[key]}<strong className="block">UGX {value.toLocaleString()}</strong></p>)}</div>
   <div className="flex flex-wrap gap-3"><label>Payroll period<input className="border rounded p-2" type="month" value={period} onChange={e=>setPeriod(e.target.value)}/></label><label>Employee<select className="border rounded p-2" value={employee} onChange={e=>setEmployee(e.target.value)}><option value="">All employees</option>{[...new Map(report.payrollRows.map(r=>[r.staffId,r.employee])).entries()].map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label></div>
   <div className="overflow-x-auto"><table className="text-sm w-full"><thead><tr>{['Employee','Branch','Period','Gross','PAYE','NSSF employee','NSSF employer','Net payable','Paid','Outstanding','Due date','Status'].map(h=><th key={h} className="p-2 text-left whitespace-nowrap">{h}</th>)}</tr></thead><tbody>{selected.map(r=><tr key={r.id}>{[r.employee,r.branchId,r.period,r.grossUGX,r.payeUGX,r.employeeNssfUGX,r.employerNssfUGX,r.netPayableUGX,r.paidUGX,r.outstandingUGX,r.dueDate||'Unspecified',r.overdue?'Overdue; '+r.status:r.status].map((v,i)=><td key={i} className="border-t p-2 whitespace-nowrap">{typeof v==='number'?v.toLocaleString():v}</td>)}</tr>)}</tbody></table></div>
   <div className="flex flex-wrap gap-3">{[['Payroll',selected],['Advances',report.advanceRows],['Welfare',report.benefitRows],['Accounts',report.accountRows],['Movements',report.movementRows]].map(([title,records])=><button key={title as string} className="border rounded p-2" onClick={()=>csv('phase5-'+String(title).toLowerCase(),records as any[])}>Export {title as string}</button>)}</div>
   <p className="text-xs">Payroll filters apply to the payroll table/export. Reconciliation totals use the complete loaded scope. These are accrued statutory obligations, not evidence of remittance. Staff contributions or co-pay recoveries require an explicitly approved classification; POS allocation is never treated as a cash receipt.</p>
   {!!report.exceptions.length&&<ul className="list-disc pl-5 text-sm text-rose-700">{report.exceptions.map(e=><li key={e}>{e}</li>)}</ul>}
  </div>}
 </details>;
}
