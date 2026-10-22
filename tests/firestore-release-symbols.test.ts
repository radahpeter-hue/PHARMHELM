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
