import type { PettyCashIssue, PettyCashRequisition } from '../types';
export type PettyCashExportRow = Record<string, string | number>;
export function pettyCashIssueRows(records: PettyCashIssue[]): PettyCashExportRow[] {
  return records.map(r => ({ 'Record ID': r.id, Branch: r.branch_name, 'Issue Date': r.issue_date,
    Reference: r.reference_number, 'Requisition ID': r.requisition_id, 'Amount (UGX)': r.amount,
    Status: r.status, 'Issued By': r.issued_by, 'Received By': r.received_by || '',
    'Received At': r.received_at || '', Notes: r.notes || '' }));
}
export function pettyCashRequisitionRows(records: PettyCashRequisition[]): PettyCashExportRow[] {
  return records.map(r => ({ 'Record ID': r.id, Branch: r.branch_name, Date: r.requisition_date,
    'Amount (UGX)': r.amount_requested, Purpose: r.reason, Status: r.status,
    'Finance Approved By': r.finance_approval_by || '', 'CEO Approved By': r.ceo_approval_by || '',
    'Disbursed At': r.disbursed_at || '' }));
}
export function pettyCashReportRows(rows: PettyCashExportRow[]): PettyCashExportRow[] {
  return [...rows, { 'Record ID': 'TOTAL', 'Amount (UGX)': rows.reduce((sum, r) => sum + Number(r['Amount (UGX)']), 0) }];
}
export function pettyCashCSV(rows: PettyCashExportRow[]): string {
  const headers = Array.from(new Set(rows.flatMap(Object.keys)));
  const cell = (v: string | number = '') => {
    let text = String(v);
    if (typeof v === 'string' && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  return '\uFEFF' + [headers, ...rows.map(r => headers.map(h => r[h] ?? ''))]
    .map(row => row.map(cell).join(',')).join('\r\n');
}
