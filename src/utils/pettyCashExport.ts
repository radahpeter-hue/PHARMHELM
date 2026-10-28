import type { PettyCashIssue, PettyCashRequisition } from '../types';
import { staffReportIdentity } from './staffReportIdentity';
import type { IdentityStaff } from './staffIdentityAudit';
import { sumEodAmounts, eodAmountNumber } from './eodMoney';
export type PettyCashExportRow = Record<string, string | number>;
export type PettyCashReportContext = {tenantId: string; staff: IdentityStaff[]; requisitions?: PettyCashRequisition[]};
export function pettyCashReportDate(value: unknown, time=false): string {
 if(!value)return 'Not recorded';
 const date=value instanceof Date?value:typeof (value as any)?.toDate==='function'?(value as any).toDate():new Date(String(value).length===10?`${value}T12:00:00Z`:String(value));
 if(!Number.isFinite(date.getTime()))return 'Date unavailable';
 return new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Kampala',day:'2-digit',month:'2-digit',year:'numeric',...(time?{hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23' as const}:{})}).format(date)+(time?' EAT':'');
}
const status=(s:string)=>String(s||'Not recorded').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
export function pettyCashIssueRows(records: PettyCashIssue[], context: PettyCashReportContext={tenantId:'',staff:[]}): PettyCashExportRow[] {
 return records.map(r=>{
  const req=context.requisitions?.find(q=>q.id===r.requisition_id&&q.tenantId===context.tenantId);
  return {Branch:r.branch_name||'Branch not recorded','Issue Date':pettyCashReportDate(r.issue_date),Reference:r.reference_number||'Not recorded',
   'Requisition Purpose':req?.reason||(r.requisition_id?'Requisition unavailable':'Not linked'),'Amount (UGX)':eodAmountNumber(r.amount),Status:status(r.status),
   'Issued By':staffReportIdentity(r.issued_by,context.staff,context.tenantId),'Received By':staffReportIdentity(r.received_by,context.staff,context.tenantId),
   'Received At (EAT)':pettyCashReportDate(r.received_at,true),Notes:r.notes||''};
 });
}
export function pettyCashRequisitionRows(records: PettyCashRequisition[], context: PettyCashReportContext={tenantId:'',staff:[]}): PettyCashExportRow[] {
 return records.map(r=>({Branch:r.branch_name||'Branch not recorded',Date:pettyCashReportDate(r.requisition_date),Purpose:r.reason||'Not recorded',
  'Amount (UGX)':eodAmountNumber(r.amount_requested),Status:status(r.status),
  'Finance Approved By':staffReportIdentity(r.finance_approval_by,context.staff,context.tenantId),'CEO Approved By':staffReportIdentity(r.ceo_approval_by,context.staff,context.tenantId),
  'Disbursed At (EAT)':pettyCashReportDate(r.disbursed_at,true)}));
}
export function pettyCashReportRows(rows: PettyCashExportRow[]): PettyCashExportRow[] {
 if(!rows.length)return [];
 return [...rows,{[Object.keys(rows[0])[0]]:'TOTAL','Amount (UGX)':sumEodAmounts(rows.map(r=>r['Amount (UGX)']))}];
}
export function pettyCashCSV(rows: PettyCashExportRow[]): string {
 const headers=Array.from(new Set(rows.flatMap(Object.keys)));
 const cell=(v:string|number='')=>{let text=String(v);if(typeof v==='string'&&/^[\s]*[=+@-]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';};
 return '\uFEFF'+[headers,...rows.map(r=>headers.map(h=>r[h]??''))].map(row=>row.map(cell).join(',')).join('\r\n');
}
