import test from 'node:test';
import assert from 'node:assert/strict';
import {compactRuleSymbols} from '../scripts/build-firestore-release-rules.mjs';
test('release compaction renames internal symbols while preserving paths, fields and role literals',()=>{
 const source=`rules_version = '2'; service cloud.firestore { match /databases/{database}/documents {
 // comment must not change quoted text
 function allowed(data, before) { let staff = data.staff; return before.amount == data.amount && staff.role == 'Finance Head' && data.note == '// literal'; }
 match /staff/{staffId} { allow update: if allowed(request.resource.data, resource.data); }
 }} `;
 const result=compactRuleSymbols(source);
 assert.match(result,/match \/staff\/\{staffId\}/);
 assert.match(result,/\.staff/);assert.match(result,/\.amount/);assert.match(result,/'Finance Head'/);assert.match(result,/'\/\/ literal'/);
 assert.doesNotMatch(result,/function allowed\(/);assert.doesNotMatch(result,/\bdata\.amount/);assert.match(result,/let staff =/);
 assert.equal(compactRuleSymbols(source),result);
});
test('release compaction does not collide with existing internal identifiers or rewrite property methods',()=>{
 const result=compactRuleSymbols(`function _f0(data) { let _v0 = data.get('value', 'a\\'b'); return _v0; }`);
 assert.doesNotMatch(result,/function _f0\(/);assert.match(result,/\.get\('value', 'a\\'b'\)/);
});
test('tenant factoring preserves exact scope and quoted expressions', async () => {
 const {shareTenantPredicates} = await import('../scripts/build-firestore-release-rules.mjs');
 const source = `service cloud.firestore { match /databases/{database}/documents {
 function isTenantMember(tenantId) { return tenantId == request.auth.token.tenantId; }
 match /entries/{id} { allow read: if isTenantMember(resource.data.tenantId);
 allow create: if isTenantMember(request.resource.data.tenantId) && request.resource.data.note == 'isTenantMember(resource.data.tenantId)'; }
 }}`;
 const factored = shareTenantPredicates(source);
 assert.match(factored,/allow read: if sharedExistingTenant\(\)/);
 assert.match(factored,/allow create: if sharedRequestedTenant\(\)/);
 assert.match(factored,/'isTenantMember\(resource.data.tenantId\)'/);
 assert.match(factored,/function sharedExistingTenant\(\) \{ return isTenantMember\(resource.data.tenantId\); \}/);
 assert.match(factored,/function sharedRequestedTenant\(\) \{ return isTenantMember\(request.resource.data.tenantId\); \}/);
});
test('shared document reads preserve get versus getAfter, document IDs and literal text', async()=>{
 const {shareDocumentReads}=await import('../scripts/build-firestore-release-rules.mjs');
 const source=`service cloud.firestore { match /databases/{database}/documents {
 function before(id) { return get(/databases/$(database)/documents/staff/$(id)).data; }
 function one(data) { return getAfter(/databases/$(database)/documents/staff/$(data.staffId)).data; }
 function two(data) { return getAfter(/databases/$(database)/documents/staff/$(data.otherId)).data; }
 function three(data) { return getAfter(/databases/$(database)/documents/staff/$(data.tenantId + '_' + data.staffId)).data; }
 function nested(id) { return getAfter(/databases/$(database)/documents/staff/$(id)/state/current).data; }
 function quoted() { return 'getAfter(/databases/$(database)/documents/staff/$(id)).data'; }
 }}`;
 const result=shareDocumentReads(source);
 assert.match(result,/function sharedDocumentRead0\(sharedDocumentId0\) \{ return getAfter\(\/databases\/\$\(database\)\/documents\/staff\/\$\(sharedDocumentId0\)\).data; \}/);
 assert.match(result,/return sharedDocumentRead0\(data.staffId\)/);
 assert.match(result,/return sharedDocumentRead0\(data.tenantId \+ '_' \+ data.staffId\)/);
 assert.match(result,/return get\(\/databases/);
 assert.match(result,/\/state\/current/);
 assert.match(result,/'getAfter\(\/databases/);
});
test('map field sharing retains exact lookup names and does not rewrite methods or literals',async()=>{
 const {shareFieldReads}=await import('../scripts/build-firestore-release-rules.mjs');
 const source=`service cloud.firestore { match /databases/{database}/documents {
 function allowed(data) { return ${Array.from({length:20},()=>"data.tenantId == request.resource.data.tenantId && data.quantityDispatched == 1 && data.affectedKeys().hasOnly(['tenantId'])").join(' && ')}; }
 function quoted() { return 'data.tenantId'; }
 }}`;
 const result=shareFieldReads(source);
 assert.match(result,/function sharedField_tenantId\(sharedRecord\) \{ return sharedRecord.tenantId; \}/);
 assert.match(result,/sharedField_tenantId\(request.resource.data\)/);
 assert.match(result,/sharedField_quantityDispatched\(data\)/);
 assert.match(result,/data.affectedKeys\(\).hasOnly\(\['tenantId'\]\)/);
 assert.match(result,/'data.tenantId'/);
});
test('nested point-read factoring preserves existence methods and multiple path interpolations',async()=>{
 const {shareDocumentReads}=await import('../scripts/build-firestore-release-rules.mjs');
 const checks=Array.from({length:3},()=>"existsAfter(/databases/$(database)/documents/payroll/$(data.id)/settlements/$(data.requestId)) && get(/databases/$(database)/documents/payroll/$(data.id)/state/current).data.outstandingUGX >= 0").join(' && ');
 const result=shareDocumentReads(`service cloud.firestore { match /databases/{database}/documents {function valid(data){return ${checks};}}}`);
 assert.match(result,/return existsAfter\(\/databases\/\$\(database\)\/documents\/payroll\/\$\(sharedDocumentId0\)\/settlements\/\$\(sharedDocumentId1\)\);/);
 assert.match(result,/sharedDocumentRead0\(data.id,data.requestId\)/);
 assert.match(result,/get\(\/databases\/\$\(database\)\/documents\/payroll\/\$\(sharedDocumentId0\)\/state\/current\).data/);
 assert.match(result,/sharedDocumentRead1\(data.id\).outstandingUGX/);
});
test('release pipeline shares repeated field lookups without changing literal field names',()=>{
 const checks=Array.from({length:30},()=>"data.outstandingUGX >= 0 && data.tenantId == 'tenant' && data.get('optional', false) == false").join(' && ');
 const result=compactRuleSymbols(`service cloud.firestore { match /databases/{database}/documents { function valid(data) { return ${checks}; } } }`);
 assert.equal((result.match(/\.outstandingUGX/g)||[]).length,1);
 assert.equal((result.match(/\.tenantId/g)||[]).length,1);
 assert.match(result,/\.get\('optional', false\)/);
 assert.match(result,/'tenant'/);
});
test('equal-field sharing preserves operand boundaries, lazy guards and literal text',async()=>{
 const {shareFieldComparisons}=await import('../scripts/build-firestore-release-rules.mjs');
 const checks=Array.from({length:5},()=>"left.tenantId == right.tenantId && left.branchId == right.branchId").join(' && ');
 const source=`service cloud.firestore { match /databases/{database}/documents { function valid(left,right) { return left != null && (${checks}) && left.tenantId == right.tenantId + 'suffix' && 'prefix' + left.tenantId == right.tenantId && left.tenantId == right.tenantId[0] && !left.tenantId == right.tenantId; } function quoted(){ return 'left.tenantId == right.tenantId'; } } }`;
 const result=shareFieldComparisons(source);
 assert.match(result,/left != null && \(sharedEqualField_tenantId\(left,right\)/);
 assert.match(result,/function sharedEqualField_branchId\(sharedLeft,sharedRight\) \{ return sharedLeft.branchId == sharedRight.branchId; \}/);
 assert.match(result,/left.tenantId == right.tenantId \+ 'suffix'/);
 assert.match(result,/'prefix' \+ left.tenantId == right.tenantId/);
 assert.match(result,/left.tenantId == right.tenantId\[0\]/);
 assert.match(result,/!left.tenantId == right.tenantId/);
 assert.match(result,/'left.tenantId == right.tenantId'/);
});
test('write-map caching leaves missing-resource reads and deletes unchanged',async()=>{
 const {cacheWriteResourceMaps}=await import('../scripts/build-firestore-release-rules.mjs');
 const checks=Array.from({length:8},()=>"request.resource.data.amount == resource.data.amount").join(' && ');
 const source=`service cloud.firestore { match /databases/{database}/documents { match /entries/{id} {
 allow get: if resource == null || resource.data.tenantId == request.auth.token.tenantId;
 allow update: if ${checks};
 allow create, update: if ${checks};
 allow delete: if resource.data.tenantId == request.auth.token.tenantId;
 }}}`;
 const result=cacheWriteResourceMaps(source);
 assert.match(result,/let cachedWriteExpression0_before = resource.data/);
 assert.match(result,/let cachedWriteExpression0_after = request.resource.data/);
 assert.match(result,/cachedWriteExpression0_after.amount == cachedWriteExpression0_before.amount/);
 assert.match(result,/allow update: if cachedWriteExpression0\(\)/);
 assert.match(result,/allow get: if resource == null \|\| resource.data.tenantId/);
 assert.match(result,/allow delete: if resource.data.tenantId/);
 assert.doesNotMatch(result,/let cachedWriteExpression1_before/);
});
test('three repeated write-map reads are cached without moving reads into mixed write/delete rules',async()=>{
 const {cacheWriteResourceMaps}=await import('../scripts/build-firestore-release-rules.mjs');
 const checks='request.resource.data.amount is int && request.resource.data.amount >= 0 && request.resource.data.amount <= 100';
 const result=cacheWriteResourceMaps(`match /entries/{id} { allow create: if ${checks}; allow write: if ${checks}; allow create, delete: if ${checks}; }`);
 assert.match(result,/let cachedWriteExpression0_after = request.resource.data/);
 assert.match(result,/allow create: if cachedWriteExpression0\(\)/);
 assert.match(result,/allow write: if request.resource.data.amount/);
 assert.match(result,/allow create, delete: if request.resource.data.amount/);
});
