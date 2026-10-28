import test from 'node:test';
import assert from 'node:assert/strict';
import { canUseBranchExpenseCategory, eligibleExpenseStaff, expenseStaffName, staffExpenseAttribution, isAllowanceCategory, expenseRecipientTypeAllowed } from '../src/utils/branchExpensePolicy';

test('new manual expenses cannot be salaries, including casing/spacing variants', () => {
  for (const category of ['salaries', 'Salaries', ' SALARY ']) {
    assert.equal(canUseBranchExpenseCategory(category), false);
    assert.equal(canUseBranchExpenseCategory(category, 'utilities'), false);
  }
  assert.equal(canUseBranchExpenseCategory('utilities'), true);
});

test('historical salary records remain readable and can retain their original category', () => {
  assert.equal(canUseBranchExpenseCategory('salaries', 'salaries'), true);
  assert.equal(canUseBranchExpenseCategory('utilities', 'salaries'), true);
});

// Existing consolidated reports derive filters from persisted category values.
// Verify the entry option reaches the existing reporting path without remapping history.
import fs from 'node:fs';
test('Allowances is selectable and report categories remain data-driven', () => {
  const source = fs.readFileSync('src/pages/Finance.tsx', 'utf8');
  const branch = source.split('const BranchExpenseLog:')[1].split('const BranchCreditView:')[0];
  assert.match(branch, /<option value="allowances">Allowances<\/option>/);
  assert.equal(canUseBranchExpenseCategory('allowances'), true);
  const report = fs.readFileSync('src/pages/finance/management/GlobalExpenseLedger.tsx', 'utf8');
  assert.match(report, /new Set\(consolidatedList.map\(e => e.category\)/);
});

test('Issued To is written on create and edit, restored when editing, and reviewed on the record', () => {
  const branch = fs.readFileSync('src/pages/Finance.tsx', 'utf8').split('const BranchExpenseLog:')[1].split('const BranchCreditView:')[0];
  assert.equal((branch.match(/issued_to: issuedTo/g) || []).length, 2);
  assert.match(branch, /recipient: exp.issued_to/);
  assert.match(branch, /expense.issued_to \|\| 'Not recorded'/);
});

import type { Staff } from '../src/types';
test('staff dropdown uses current authoritative tenant staff and distinguishes duplicate names', () => {
  const rows = [
    { id: 'a', tenantId: 't', full_name: 'Alex', active: true, status: 'active' },
    { id: 'b', tenantId: 't', full_name: 'Alex', active: true, status: 'active' },
    { id: 'cross', tenantId: 'other', full_name: 'Other tenant', active: true },
    { id: 'inactive', tenantId: 't', active: false, status: 'active' },
    { id: 'suspended', tenantId: 't', active: true, status: 'suspended' }
  ] as Staff[];
  assert.deepEqual(eligibleExpenseStaff(rows, 't').map(s => s.id), ['a', 'b']);
  assert.equal(expenseStaffName(rows[0]), 'Alex');
});

test('staff attribution preserves immutable document identity despite duplicate names or later name changes', () => {
  const staff = { id: 'staff-immutable-001', full_name: 'Original Name', staff_code: 'MP-001' } as Staff;
  const saved = { ...staffExpenseAttribution(staff), issued_to: expenseStaffName(staff) };
  staff.full_name = 'Changed Name';
  assert.equal(saved.recipient_staff_id, 'staff-immutable-001');
  assert.equal(saved.recipient_type, 'staff');
  assert.equal(saved.issued_to, 'Original Name');
  assert.equal(staffExpenseAttribution(staff).recipient_staff_id, saved.recipient_staff_id);
});

test('ordinary expenses allow an explicit external recipient without creating staff accounts', () => {
  const branch = fs.readFileSync('src/pages/Finance.tsx', 'utf8').split('const BranchExpenseLog:')[1].split('const BranchCreditView:')[0];
  assert.match(branch, /value="external">Outsource \/ External/);
  assert.match(branch, /recipient_type: 'external' as const, recipient_staff_id: ''/);
  assert.doesNotMatch(branch, /addDocument\('staff'/);
  assert.match(branch, /setEditingExpense\(null\); setRecipientType\('external'\); setSelectedStaffId\(''\)/);
});

test('external recipients are rejected for allowance aliases, including forged submit values', () => {
  for (const category of ['Allowance', 'Allowances', ' allowances ', 'Allowances Issued']) {
    assert.equal(isAllowanceCategory(category), true);
    assert.equal(expenseRecipientTypeAllowed(category, 'external'), false);
    assert.equal(expenseRecipientTypeAllowed(category, 'staff'), true);
  }
  assert.equal(expenseRecipientTypeAllowed('utilities', 'external'), true);
});
