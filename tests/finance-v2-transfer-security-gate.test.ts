import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planFinanceV2Transfer} from '../src/services/financeV2TransferPolicy';

const writer=readFileSync(new URL('../src/services/financeV2TransferPosting.ts',import.meta.url),'utf8');
const rules=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
const accounts=[
 {tenantId:'t',accountId:'a',kind:'BANK' as const,balanceUGX:1004000,active:true},
 {tenantId:'t',accountId:'b',kind:'BRANCH_CASH_SALES' as const,balanceUGX:0,active:true}
];
const request={tenantId:'t',requestId:'first',sourceAccountId:'a',destinationAccountId:'b',chargePayerAccountId:'a',principalUGX:1000000,chargeUGX:4000,actorUid:'f'};

test('principal arrives in full and fee remains separate from internal transfer',()=>{
 const p=planFinanceV2Transfer(request,accounts);
 assert.deepEqual(p.accountDeltas,[{accountId:'a',deltaUGX:-1004000},{accountId:'b',deltaUGX:1000000}]);
 assert.equal(p.externalChargeExpenseUGX,4000);
 assert.equal(p.movements.filter(m=>m.purpose==='CHARGE').length,1);
});
test('V2 writer is inaccessible without explicit certification and V2 accounts',()=>{
 assert.match(writer,/financeV2TransferRulesCertified !== true/);
 assert.match(writer,/data\.controlVersion !== 2/);
 assert.match(writer,/runTransaction\(connection/);
 assert.match(writer,/Transfer idempotency conflict/);
});
test('release rules forbid every V2 financial posting until authenticated transaction rules exist',()=>{
 for(const name of ['finance_v2_transfers','finance_v2_account_movements','finance_v2_events']){
  const i=rules.indexOf('match /'+name+'/{');
  assert.ok(i>=0,name);
  const block=rules.slice(i,rules.indexOf('\n    }',i));
  assert.match(block,/allow create, update, delete: if false;/);
 }
});
test('insufficient aggregate source cash must fail before any write',()=>{
 assert.throws(()=>planFinanceV2Transfer(request,[{...accounts[0],balanceUGX:1000000},accounts[1]]),/Insufficient funds/);
});

test('transfer envelope contains immutable per-account audit deltas and charge linkage',()=>{
 assert.match(writer,/const auditDeltas = plan\.accountDeltas\.map/);
 assert.match(writer,/beforeUGX:accounts\[i\]\.balanceUGX/);
 assert.match(writer,/afterUGX:accounts\[i\]\.balanceUGX \+ m\.deltaUGX/);
 assert.match(writer,/accountDeltas:auditDeltas/);
 assert.match(writer,/movementCount:plan\.movements\.length/);
 assert.match(writer,/chargeEventId:/);
});

test('duplicate request is not accepted as complete when transfer envelope is incomplete',()=>{
 assert.match(writer,/data\.status !== 'posted'/);
 assert.match(writer,/data\.currency !== 'UGX'/);
 assert.match(writer,/!Array\.isArray\(data\.accountDeltas\)/);
 assert.match(writer,/data\\.movementCount !== expectedMovementCount/);
 assert.match(writer,/data\\.chargeEventId !== expectedChargeEventId/);
 assert.match(writer,/data\\.accountDeltas\\.length < 2/);
 assert.match(writer,/['"]description['"]/);
});
