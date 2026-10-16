import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { procurementRequestingBranchLabel } from '../src/services/procurementBranchDisplay';

test('Financial Approval displays order origin from the tenant Branch Register', () => {
  const names = { '1agW2eYBOGGqKR9w2V31': 'Masaka', 'branch-jinja': 'Jinja' };
  assert.equal(procurementRequestingBranchLabel({
    requesting_branch_id: '1agW2eYBOGGqKR9w2V31',
    requesting_branch_name: ''
  }, names), 'Masaka');
  assert.equal(procurementRequestingBranchLabel({
    requesting_branch_id: 'branch-jinja',
    requesting_branch_name: 'Stale branch label'
  }, names), 'Jinja', 'Registered name must override older embedded labels');
});

test('Financial Approval never assumes the active branch is the requesting origin', () => {
  assert.equal(procurementRequestingBranchLabel({
    requesting_branch_id: 'branch-jinja',
    requesting_branch_name: ''
  }, { 'branch-masaka': 'Masaka', 'branch-jinja': 'Jinja' }), 'Jinja');
});

test('missing branch metadata is clearly identified rather than showing an opaque ID as a name', () => {
  assert.equal(procurementRequestingBranchLabel({
    requesting_branch_id: 'branch-missing'
  }, {}), 'Branch name unavailable (ID: branch-missing)');
  assert.equal(procurementRequestingBranchLabel({
    requesting_branch_id: 'HQ', requesting_branch_name: ''
  }, {}), 'HQ Central Store');
  assert.equal(procurementRequestingBranchLabel({requesting_branch_id:''}, {}), 'Requesting branch not recorded');
});

test('Procurement uses the same master-backed origin lookup in the requisition and financial approval views', () => {
  const page = readFileSync(new URL('../src/pages/Procurement.tsx', import.meta.url), 'utf8');
  assert.match(page, /const displayBranch = \(order: StockOrder\): string =>\s*procurementRequestingBranchLabel\(order, branchNames\)/);
  const approval = page.slice(page.indexOf('const FinancialApprovalTab:'), page.indexOf('const GRNTab:'));
  assert.match(approval, /subscribeToCollection<Branch>\('branches', profile\.tenantId/);
  assert.match(approval, /Requesting Branch \(Origin\)/);
  assert.match(approval, /originBranchName=\{displayBranch\(selectedOrder\)\}/);
  assert.match(approval, /Requested by: \{originBranchName\}/);
});
