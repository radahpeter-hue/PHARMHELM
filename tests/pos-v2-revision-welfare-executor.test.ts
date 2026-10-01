import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('scripts/pos-v2-revision-welfare-executor.mjs', 'utf8');

test('welfare executor writes append-only compensation records and preserves original postings', () => {
  assert.match(source, /collection\('pos_welfare_reversals'\)/);
  assert.match(source, /collection\('welfare'\)/);
  assert.match(source, /collection\('branch_expenses'\)/);
  assert.match(source, /collection\('cashTransfers'\)/);
  assert.match(source, /tx\.create\(reversalRef,/);
  assert.match(source, /tx\.create\(reversalWelfareRef,/);
  assert.match(source, /tx\.create\(reversalExpenseRef,/);
  assert.match(source, /tx\.create\(reversalTransferRef,/);
  assert.doesNotMatch(source, /tx\.delete/);
  assert.doesNotMatch(source, /tx\.update\(originalWelfareRef/);
  assert.doesNotMatch(source, /tx\.update\(originalExpenseRef/);
  assert.doesNotMatch(source, /tx\.update\(originalTransferRef/);
});

test('welfare executor validates canonical originals and fails closed on partial reversal history', () => {
  assert.match(source, /validateWelfareOriginals/);
  assert.match(source, /assertExistingWelfareReversalMatches/);
  assert.match(source, /Welfare reversal history is partial\. Manual review required\./);
  assert.match(source, /history exists without its canonical reversal record\. Manual review required\./);
  assert.match(source, /Original welfare financial postings are incomplete\./);
});

test('welfare executor reverses beneficiary counters exactly once and blocks negative balances', () => {
  assert.match(source, /welfare_spent: Math\.max\(0, nextSpent\)/);
  assert.match(source, /welfare_used_ytd: Math\.max\(0, nextYtd\)/);
  assert.match(source, /nextSpent < -0\.0001/);
  assert.match(source, /nextYtd < -0\.0001/);
  assert.match(source, /if \(existingReversalSnap\.exists\)/);
  assert.match(source, /replayed: true/);
  assert.match(source, /replayed: false/);
});

test('welfare compensation carries explicit negative monetary deltas and a counter-transfer', () => {
  assert.match(source, /amount: expected\.amountDelta/);
  assert.match(source, /amountDelta: expected\.amountDelta/);
  assert.match(source, /fromPortfolio: 'banked'/);
  assert.match(source, /toPortfolio: 'welfare'/);
  assert.match(source, /amount: expected\.amount/);
  assert.match(source, /source: expected\.source/);
});

test('welfare executor uses deterministic original posting identities compatible with existing POS posting', () => {
  assert.match(source, /pos_welfare_\$\{key\}/);
  assert.match(source, /pos_welfare_expense_\$\{key\}/);
  assert.match(source, /pos_welfare_transfer_\$\{key\}/);
  assert.match(source, /originalWelfareRef/);
  assert.match(source, /originalExpenseRef/);
  assert.match(source, /originalTransferRef/);
});
