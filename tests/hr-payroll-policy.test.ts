import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePayrollDraft } from '../src/services/hrPayrollPolicy';
test('valid non-posting payroll balances', () => assert.equal(validatePayrollDraft({baseSalary:100000,bonuses:10000,deductions:20000,netSalary:90000}), null));
test('reject invalid arithmetic and negative net', () => {
  assert.ok(validatePayrollDraft({baseSalary:100000,bonuses:0,deductions:20000,netSalary:90000}));
  assert.ok(validatePayrollDraft({baseSalary:100000,bonuses:0,deductions:120000,netSalary:-20000}));
  assert.ok(validatePayrollDraft({baseSalary:1.5,bonuses:0,deductions:0,netSalary:1.5}));
});
