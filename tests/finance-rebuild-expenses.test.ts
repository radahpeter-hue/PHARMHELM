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
