import test from 'node:test';
import assert from 'node:assert/strict';
import { canUseBranchExpenseCategory } from '../src/utils/branchExpensePolicy';

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
