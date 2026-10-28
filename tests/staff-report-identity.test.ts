import {test} from 'node:test';import assert from 'node:assert/strict';
import {staffReportIdentity} from '../src/utils/staffReportIdentity';
import {pettyCashIssueRows,pettyCashRequisitionRows,pettyCashReportRows,pettyCashCSV} from '../src/utils/pettyCashExport';
const canonical={id:'uid',uid:'uid',tenantId:'mp',full_name:'Alex Example',staff_code:'STF-000001'};
const staff=[canonical,{id:'old',tenantId:'mp',duplicate_of:'uid',retired_staff_code:'STF-000002'}];
test('export resolves real names and staff numbers through immutable IDs/aliases',()=>{
 assert.equal(staffReportIdentity('old',staff,'mp'),'Alex Example (STF-000001)');
 assert.equal(staffReportIdentity('uid',staff,'other'),'Staff record unavailable');
 assert.equal(staffReportIdentity('missing',staff,'mp'),'Staff record unavailable');
 assert.equal(staffReportIdentity(undefined,staff,'mp'),'Not recorded');
});
test('unlinked duplicate UIDs and alias cycles are explicitly unresolved',()=>{
 assert.equal(staffReportIdentity('shared',[{...canonical,id:'a',uid:'shared'},{...canonical,id:'b',uid:'shared'}],'mp'),'Staff identity needs review');
 assert.equal(staffReportIdentity('a',[{...canonical,id:'a',duplicate_of:'b'},{...canonical,id:'b',duplicate_of:'a'}],'mp'),'Staff identity needs review');
});
test('both report types contain names, linked purpose, Kampala times and visible numeric total',()=>{
 const req={id:'raw-req',tenantId:'mp',branch_name:'Masaka',requisition_date:'2026-09-30',reason:'Branch supplies',amount_requested:50000,status:'received',finance_approval_by:'old',ceo_approval_by:'uid'} as any;
 const issue={id:'raw-issue',tenantId:'mp',branch_name:'Masaka',issue_date:'2026-09-30',reference_number:'ISS-450600',requisition_id:req.id,amount:50000,status:'received',issued_by:'old',received_by:'uid',received_at:'2026-09-30T10:26:55.183Z'} as any;
 const context={tenantId:'mp',staff,requisitions:[req]};const rows=pettyCashIssueRows([issue],context);
 assert.equal(rows[0]['Issued By'],'Alex Example (STF-000001)');assert.equal(rows[0]['Requisition Purpose'],'Branch supplies');assert.equal(rows[0]['Received At (EAT)'],'30/09/2026, 13:26:55 EAT');
 const csv=pettyCashCSV(pettyCashReportRows(rows));assert.ok(csv.includes('Alex Example'));assert.ok(!csv.includes('raw-req'));assert.ok(!csv.includes('raw-issue'));assert.equal(pettyCashReportRows(rows)[1].Branch,'TOTAL');
 assert.equal(pettyCashRequisitionRows([req],context)[0]['CEO Approved By'],'Alex Example (STF-000001)');
});
