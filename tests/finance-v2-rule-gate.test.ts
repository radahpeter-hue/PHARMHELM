import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const names = ['finance_v2_transfers','finance_v2_account_movements','finance_v2_events'] as const;

test('new financial collections have explicit deny-all write rules while uncertified', () => {
  for (const name of names) {
    const match = rules.match(new RegExp('match /' + name + '/\\{[^}]+\\} \\{([\\s\\S]*?)\\n    \\}'));
    assert.ok(match, name + ' must have an explicit collection rule');
    assert.match(match[1], /allow create, update, delete: if false;/);
    assert.doesNotMatch(match[1], /allow write: if true/);
  }
});

test('fallback exclusion denies generic write access to V2 collections', () => {
  const protectedList = rules.match(/function isProtectedFinanceCollection\(collectionName\) \{([\s\S]*?)\n    \}/)?.[1];
  assert.ok(protectedList);
  for (const name of names) assert.ok(protectedList.includes("'" + name + "'"),name + ' excluded from generic writes');
});

test('existing Management account and ledger gates remain present', () => {
  assert.match(rules,/match \/finance_payment_accounts\/\{accountId\}/);
  assert.match(rules,/validManagementAccountUpdate\(accountId, resource.data, request.resource.data\)/);
  assert.match(rules,/match \/petty_cash_ledger\/\{entryId\}/);
  assert.match(rules,/validManagementMovement\(entryId, request.resource.data, 'petty_cash'\)/);
});
