import test from 'node:test';
import assert from 'node:assert/strict';
import {bindWriteSnapshots,compactRuleSymbols} from '../scripts/build-firestore-release-rules.mjs';
test('release compaction renames internal symbols while preserving paths, fields and role literals',()=>{
 const source=`rules_version = '2'; service cloud.firestore { match /databases/{database}/documents {
 // comment must not change quoted text
 function allowed(data, before) { let staff = data.staff; return before.amount == data.amount && staff.role == 'Finance Head' && data.note == '// literal'; }
 match /staff/{staffId} { allow update: if allowed(request.resource.data, resource.data); }
 }} `;
 const result=compactRuleSymbols(source);
 assert.match(result,/match \/staff\/\{[A-Za-z]+\}/);
 assert.match(result,/\.staff/);assert.match(result,/\.amount/);assert.match(result,/'Finance Head'/);assert.match(result,/'\/\/ literal'/);
 assert.doesNotMatch(result,/function allowed\(/);assert.doesNotMatch(result,/\bdata\.amount/);assert.match(result,/let staff =/);
 assert.equal(compactRuleSymbols(source),result);
});
test('release compaction does not collide with existing internal identifiers or rewrite property methods',()=>{
 const result=compactRuleSymbols(`function _f0(data) { let _v0 = data.get('value', 'a\\'b'); return _v0; }`);
 assert.doesNotMatch(result,/function _f0\(/);assert.match(result,/\.get\('value', 'a\\'b'\)/);
});

test('release symbols rename wildcard bindings and every database reference together',()=>{
 const source="service cloud.firestore { match /databases/{database}/documents { match /staff/{staffId} { allow get: if get(/databases/$(database)/documents/staff/$(staffId)).data.staffId == staffId; } } }";
 const result=compactRuleSymbols(source);const database=result.match(/databases\/\{([A-Za-z]+)\}/)[1],staff=result.match(/staff\/\{([A-Za-z]+)\}/)[1];
 assert.ok(result.includes('/databases/$('+database+')/documents/staff/$('+staff+')'));assert.ok(result.includes('.data.staffId == '+staff));assert.ok(!result.includes('$(database)'));assert.equal(compactRuleSymbols(source),result);
});

test('write snapshot aliases preserve literals, comments, match scope and other methods', () => {
 const source = [
  'match /documents/{id} {',
  "  allow update: if 'label' in request.resource.data",
  "    && request.resource.data.a == resource.data.a",
  "    && request.resource.data.b == resource.data.b",
  "    && request.resource.data.c == resource.data.c",
  "    && request.resource.data.d == resource.data.d",
  "    && request.resource.data.label == 'resource.data; allow update: if false';",
  '  // allow update: if request.resource.data;',
  '  allow read, write: if resource == null;',
  '}'
 ].join('\n');
 const result = bindWriteSnapshots(source);
 assert.match(result, /let (\w+) = request\.resource\.data;/);
 assert.match(result, /let (\w+) = resource\.data;/);
 assert.match(result, /return\s+'label' in releaseSnapshot\d+/);
 assert.ok(result.includes("'resource.data; allow update: if false'"));
 assert.ok(result.includes('// allow update: if request.resource.data;'));
 assert.ok(result.includes('allow read, write: if resource == null;'));
 assert.ok(result.startsWith('match /documents/{id} {'));
 assert.equal(bindWriteSnapshots(result), result);
});
