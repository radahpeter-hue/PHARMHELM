import test from 'node:test';
import assert from 'node:assert/strict';
import {compactRuleSymbols,shareFieldReaders,shareRequestFields,packEqualityConjunctions,uniqueLocalFunctions} from '../scripts/build-firestore-release-rules.mjs';
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

test('pure field readers preserve conditional lookup positions, literals and authority fields',()=>{
 const source=`service cloud.firestore { match /databases/{database}/documents {
 function permitted(row) { return row == null || (row.amountUGX > 0 && row.amountUGX < 10 && row.amountUGX != 3 && row.amountUGX != 4 && row.amountUGX != 5); }
 match /records/{id} { allow read: if permitted(resource.data) && resource.data.tenantId == 'row.amountUGX'; }
 } }`;
 const result=shareFieldReaders(source);
 assert.match(result,/return value.amountUGX/);
 assert.match(result,/row == null \|\| \(releaseFieldReader/);
 assert.match(result,/'row.amountUGX'/);
 assert.match(result,/resource.data.tenantId/);
 const extract=(text:string)=>text.slice(text.indexOf('function '),text.indexOf('match /records/'));
 for(const row of [null,{}, {amountUGX:-1},{amountUGX:1},{amountUGX:3},{amountUGX:10}]){
  const run=(text:string)=>{try{return Function(extract(text)+';return permitted(arguments[0]);')(row)===true;}catch{return false;}};
  assert.equal(run(result),run(source));
 }
});

test('repeated request fields remain lazy, exact and distinct between old and new snapshots',()=>{
 const source=`service cloud.firestore { match /databases/{database}/documents {
 function check() { return request.resource.data.amountUGX > 0 && request.resource.data.amountUGX < 10 && request.resource.data.amountUGX != resource.data.amountUGX; }
 // request.resource.data.amountUGX
 match /rows/{id} { allow update: if check(); }
 } }`;
 const output=shareRequestFields(source);
 assert.match(output,/function releaseRequestField0\(\) \{ return request.resource.data.amountUGX;/);
 assert.match(output,/resource.data.amountUGX/);
 assert.match(output,/\/\/ request.resource.data.amountUGX/);
 assert.equal(shareRequestFields(output),output);
});
test('required equality packing only changes positive predicate use through the call graph',()=>{
 const root=(body:string,grant:string)=>`service cloud.firestore { match /databases/{database}/documents { function check(d) { return ${body}; } function wrapper(d) { return check(d); } match /rows/{id} { allow create: if ${grant}; } } }`;
 const body='d.a == 1 && d.b == 2 && d.c == 3';
 assert.match(packEqualityConjunctions(root(body,'wrapper(request.resource.data)')), /\[\s*d.a\s*,\s*d.b\s*,\s*d.c\s*\]==\[\s*1\s*,\s*2\s*,\s*3\s*\]/);
 for(const grant of ['!wrapper(request.resource.data)','wrapper(request.resource.data) == false','wrapper(request.resource.data) ? false : true','wrapper(request.resource.data) && !wrapper(request.resource.data)']){
  const source=root(body,grant);assert.equal(packEqualityConjunctions(source),source);
 }
 const literal=root("d.a == 'a && b' && d.b == 2 && d.c == 3",'wrapper(request.resource.data)');
 assert.match(packEqualityConjunctions(literal), /'a && b'/);
});
test('equality packing leaves negative subexpressions and ternary conditions untouched',()=>{
 const source=`function check(d) { return !(d.a == 1 && d.b == 2 && d.c == 3) || ((d.a == 1 && d.b == 2 && d.c == 3) ? true : false); }`;
 assert.equal(packEqualityConjunctions(source).replace(/\s/g,''),source.replace(/\s/g,''));
 const branches=`function check(d) { return d.enabled ? d.a == 1 && d.b == 2 && d.c == 3 : false; }`;
 assert.equal(packEqualityConjunctions(branches),branches);
});

test('guarded boolean choices retain negative contexts and do not rewrite value-valued ternaries',()=>{
 const source=`service cloud.firestore { match /databases/{database}/documents {
 function positive(d) { return d.ready ? d.a == 1 && d.b == 2 && d.c == 3 : false; }
 function value(d) { return d.ready ? 'yes' : 'no'; }
 function negative(d) { return d.a == 1 && d.b == 2 && d.c == 3; }
 match /rows/{id} { allow create: if positive(request.resource.data) && !negative(request.resource.data) && value(request.resource.data) == 'yes'; }
 } }`;
 const result=packEqualityConjunctions(source,{booleanChoices:true});
 assert.match(result,/function positive\(d\).*\|\|/);
 assert.match(result,/function value\(d\) \{ return d.ready \? 'yes' : 'no'; \}/);
 assert.match(result,/function negative\(d\) \{ return d.a == 1 && d.b == 2 && d.c == 3; \}/);
});

test('sibling local helper names become unique without changing root lookup, literals or paths',()=>{
 const source=`service cloud.firestore { match /databases/{database}/documents {
 function check() { return false; }
    match /alpha/{id} {
      function check() { return request.resource.data.kind == 'alpha'; }
      allow create: if check();
    }
    match /beta/{id} {
      function check() { return request.resource.data.kind == 'beta'; }
      allow create: if check();
    }
 } }`;
 const result=uniqueLocalFunctions(source);
 assert.match(result,/function check\(\) \{ return false;/);
 assert.match(result,/function releaseScopedHelper0\(\)/);
 assert.match(result,/allow create: if releaseScopedHelper0\(\)/);
 assert.match(result,/function releaseScopedHelper1\(\)/);
 assert.match(result,/allow create: if releaseScopedHelper1\(\)/);
 assert.match(result,/\/alpha\/\{id\}/);assert.match(result,/'alpha'/);
});
