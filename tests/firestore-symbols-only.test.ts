import test from 'node:test';
import assert from 'node:assert/strict';
import {compactRuleSymbols} from '../scripts/build-firestore-release-rules.mjs';
test('symbols-only diagnostic leaves paths, literals and grants intact without policy transforms',()=>{
 const source=`rules_version = '2'; service cloud.firestore { match /databases/{database}/documents {
 function check(tenantId) { return request.auth != null && tenantId == 'tenant-value'; }
 match /payroll/{employeeId} { allow read: if check(resource.data.tenantId); allow write: if false; }
 } }`;
 const output=compactRuleSymbols(source,{minimal:true});
 assert.equal((output.match(/function /g)||[]).length,1);
 assert.match(output,/\/payroll\/\{/);
 assert.match(output,/allow write: if false;/);
 assert.match(output,/'tenant-value'/);
 assert.match(output,/resource.data.tenantId/);
 assert.doesNotMatch(output,/function check\(/);
});
