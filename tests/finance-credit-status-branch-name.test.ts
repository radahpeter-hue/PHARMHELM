import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const finance = fs.readFileSync('src/pages/Finance.tsx', 'utf8');
const ledger = fs.readFileSync('src/pages/finance/management/CreditLedger.tsx', 'utf8');

test('Branch Credit View subscribes to authoritative credit receivables', () => {
  assert.ok(finance.includes("subscribeToCollection('credit_receivables'"));
  assert.ok(finance.includes('r.id === credit.id'));
  assert.ok(finance.includes('r.invoice_number === invNum'));
});

test('Branch Credit View derives paid and partial states from receivable balance', () => {
  assert.ok(finance.includes("receivableStatus === 'paid' || receivableOutstanding === 0"));
  assert.ok(finance.includes('receivableOutstanding < receivableOriginal'));
  assert.ok(finance.includes("? 'Partial'"));
});

test('Management Credit Ledger resolves branch IDs through tenant branches', () => {
  assert.ok(ledger.includes("collection(db, 'branches')"));
  assert.ok(ledger.includes('branch.name || branch.branch_name || branch.branchName'));
  assert.ok(ledger.includes('branch_name: rec.branch_name || rec.branchName || branchNameById.get(branchId) || branchId'));
});

test('Management receivable table and export prefer resolved branch name', () => {
  assert.ok(ledger.includes("'Branch': c.branch_name || c.branch_id || 'HQ'"));
  assert.ok(ledger.includes("{rec.branch_name || rec.branch_id || 'HQ'}"));
});
