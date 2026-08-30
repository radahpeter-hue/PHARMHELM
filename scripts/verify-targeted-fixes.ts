import assert from 'node:assert/strict';
import { hasAnyRole } from '../src/utils/roles.ts';
import { isExcludedFromOpex } from '../src/utils/finance.ts';

assert.equal(hasAnyRole({ role: 'Cashier', secondaryRoles: ['Finance Officer'] }, ['Finance Officer']), true);
assert.equal(hasAnyRole({ role: 'Cashier', secondaryRoles: ['Dispenser'] }, ['Finance Officer']), false);

assert.equal(isExcludedFromOpex({ source: 'cash_grn' }), true);
assert.equal(isExcludedFromOpex({ source: 'credit_payment' }), true);
assert.equal(isExcludedFromOpex({ sourceType: 'credit' }), true);
assert.equal(isExcludedFromOpex({ source: 'manual' }), false);
assert.equal(isExcludedFromOpex({ source: 'cash_grn', excludeFromOpexRollup: false }), false);

const revenue = 1_000_000;
const cogs = 600_000;
const expenses = [
  { amount: 100_000, source: 'manual' },
  { amount: 50_000, source: 'hr_salary' },
  { amount: 200_000, source: 'cash_grn' }
];
const grossProfit = revenue - cogs;
const oldOpex = expenses.reduce((sum, expense) => sum + expense.amount, 0);
const correctedOpex = expenses.filter(expense => !isExcludedFromOpex(expense)).reduce((sum, expense) => sum + expense.amount, 0);
const oldNetProfit = grossProfit - oldOpex;
const correctedNetProfit = grossProfit - correctedOpex;
const pettyCashOutflow = expenses.reduce((sum, expense) => sum + expense.amount, 0);

assert.equal(grossProfit, 400_000);
assert.equal(oldOpex, 350_000);
assert.equal(correctedOpex, 150_000);
assert.equal(oldNetProfit, 50_000);
assert.equal(correctedNetProfit, 250_000);
assert.equal(pettyCashOutflow, 350_000);

console.log(JSON.stringify({ grossProfit, oldOpex, correctedOpex, oldNetProfit, correctedNetProfit, pettyCashOutflow }, null, 2));
