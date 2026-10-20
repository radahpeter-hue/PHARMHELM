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
  const match=rules.match(/match \/finance_payment_accounts\/\\{accountId\\} \\{([\\s\\S]*?)\\n    \\}/);
  assert.ok(match);
  assert.match(match[1], /financeV2AccountRegistrationEnabled/);
  assert.match(match[1], /openingBalanceUGX == 0/);
  assert.match(match[1], /balanceUGX == 0/);
  assert.match(match[1], /controlVersion == 2/);
  assert.match(match[1], /isAssignedToBranch/);
  assert.match(match[1], /validManagementAccountUpdate/);
});
test('registration contract prohibits inherited balances for branch cash',()=>{
  assert.throws(()=>planFinanceV2AccountRegistration({
    tenantId:'t',accountId:'branch_cash',name:'Branch cash',kind:'BRANCH_CASH_SALES',branchId:'branch',
    openingBalanceUGX:-100,reconciliationReference:'verified-1',actorUid:'actor'
  }),/Opening balance/);
});
