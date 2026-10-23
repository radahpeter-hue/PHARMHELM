import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planFinanceV2AccountRegistration} from '../src/services/financeV2AccountRegistryPolicy';

const source=readFileSync(new URL('../src/services/financeV2AccountRegistration.ts',import.meta.url),'utf8');
const rules=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');

test('registration service requires user identity, transaction, and zero opening while reconciliation gate remains',()=>{
  assert.match(source,/auth\.currentUser\.uid !== input\.actorUid/);
  assert.match(source,/planned\.openingBalanceUGX !== 0/);
  assert.match(source,/runTransaction\(connection/);
  assert.match(source,/if \(existing\.exists\(\)\)/);
  assert.match(source,/Account already registered/);
});
test('V2 account registration requires an explicit disabled-by-default tenant setting and zero opening',()=>{
  const start = rules.indexOf('match /finance_payment_accounts/{accountId} {');
  const end = rules.indexOf('match /cash_grn_payments/{paymentId} {', start);
  assert.ok(start >= 0 && end > start, 'Account rule section must be found');
  const accountRules = rules.slice(start, end);
  assert.match(accountRules, /financeV2AccountRegistrationEnabled/);
  assert.match(accountRules, /openingBalanceUGX == 0/);
  assert.match(accountRules, /balanceUGX == 0/);
  assert.match(accountRules, /controlVersion == 2/);
  assert.match(accountRules, /isAssignedToBranch/);
  assert.match(accountRules, /validManagementAccountUpdate/);
});
test('registration contract prohibits inherited balances for branch cash',()=>{
  assert.throws(()=>planFinanceV2AccountRegistration({
    tenantId:'t',accountId:'branch_cash',name:'Branch cash',kind:'BRANCH_CASH_SALES',branchId:'branch',
    openingBalanceUGX:-100,reconciliationReference:'verified-1',actorUid:'actor'
  }),/Opening balance/);
});
