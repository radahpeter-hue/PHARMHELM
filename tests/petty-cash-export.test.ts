import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pettyCashIssueRows, pettyCashRequisitionRows, pettyCashReportRows, pettyCashCSV } from '../src/utils/pettyCashExport';
import { inFinanceDateRange } from '../src/utils/financeDateFilters';
test('exports selected history only and sums numeric amounts without mutation', () => {
  const source = [{id:'a',branch_name:'Masaka',requisition_date:'2026-10-01',amount_requested:5000,reason:'Transport',status:'received'},{id:'b',requisition_date:'2026-09-01',amount_requested:9000}] as any;
  const selected = source.filter((r:any) => inFinanceDateRange(r.requisition_date,{start:'2026-10-01',end:'2026-10-31'}));
  const rows = pettyCashRequisitionRows(selected);
  assert.equal(rows.length,1); assert.equal(rows[0].Status,'Received');
  assert.equal(pettyCashReportRows(rows).at(-1)?.['Amount (UGX)'],5000);
  assert.equal(rows.length,1); assert.equal(source.length,2);
});
test('received ledger preserves references and receipt details', () => {
  const [row] = pettyCashIssueRows([{id:'i',branch_name:'Masaka',amount:1200,status:'received',reference_number:'REF',received_at:'2026-10-28T10:00:00Z'}] as any);
  assert.equal(row.Status,'Received');assert.equal(row.Reference,'REF');assert.equal(row['Received At (EAT)'],'28/10/2026, 13:00:00 EAT');
});
test('CSV escapes quotes and formulas while keeping numeric amounts numeric', () => {
  const csv = pettyCashCSV([{Purpose:'=1+1',Notes:'a,"b"\nΩ','Amount (UGX)':-5}]);
  assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes("\"'=1+1\""));
  assert.ok(csv.includes('"a,""b""\nΩ"')); assert.ok(csv.includes('"-5"'));
});
