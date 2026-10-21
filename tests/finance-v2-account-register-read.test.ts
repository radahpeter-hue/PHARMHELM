import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/services/financeV2AccountRegisterRead.ts',import.meta.url),'utf8');
test('Spark account register uses Firestore query constrained by tenant and V2 control version',()=>{
 assert.match(source,/getDocs\(query\(/);
 assert.match(source,/where\('tenantId', '==', scope.tenantId\)/);
 assert.match(source,/where\('controlVersion', '==', 2\)/);
 assert.match(source,/where\('branchId', '==', scope.branchId\)/);
 assert.match(source,/planFinanceV2AccountRegisterScope/);
});
test('account register cannot mutate any balance',()=>{
 assert.doesNotMatch(source,/runTransaction|updateDoc|setDoc|addDoc|deleteDoc/);
});
