import test from 'node:test';
import assert from 'node:assert/strict';
import {compactRuleSymbols,shareFieldReaders,shareRequestFields,packEqualityConjunctions,uniqueLocalFunctions,elideDuplicateTenantGrants} from '../scripts/build-firestore-release-rules.mjs';
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

test('tenant deduplication keeps prior membership and immutable tenant equality',()=>{
 const source=`allow update: if isAuthenticated() && isTenantMember(resource.data.tenantId) && isTenantMember(request.resource.data.tenantId) && request.resource.data.tenantId == resource.data.tenantId && request.resource.data.amount > 0;`;
 const output=elideDuplicateTenantGrants(source);
 assert.match(output,/isTenantMember\(resource.data.tenantId\)/);
 assert.match(output,/request.resource.data.tenantId == resource.data.tenantId/);
 assert.doesNotMatch(output,/isTenantMember\(request.resource.data.tenantId\)/);
 assert.doesNotMatch(output,/isAuthenticated\(\)/);
 const noEquality=source.replace('request.resource.data.tenantId == resource.data.tenantId && ','');
 assert.equal(elideDuplicateTenantGrants(noEquality),noEquality);
 const alternative=source.replace(' && request.resource.data.amount > 0',' || request.resource.data.public == true');
 assert.equal(elideDuplicateTenantGrants(alternative),alternative);
});

test('indexed diagnostic readers retain literal keys and pure map access',()=>{
 const source=`service cloud.firestore { match /databases/{database}/documents {
 function permitted(row) { return row == null || (row.amountUGX > 0 && row.amountUGX < 10 && row.amountUGX != 3 && row.amountUGX != 4 && row.amountUGX != 5); }
 match /records/{id} { allow read: if permitted(resource.data); }
 } }`;
 const output=shareFieldReaders(source,{indexed:true});
 assert.match(output,/value\["amountUGX"\]/);
 const extract=(text:string)=>text.slice(text.indexOf('function '),text.indexOf('match /records/'));
 for(const row of [null,{}, {amountUGX:-1},{amountUGX:1},{amountUGX:3},{amountUGX:10}]){
  const evaluate=(text:string)=>{try{return Function(extract(text)+';return permitted(arguments[0]);')(row)===true;}catch{return false;}};
  assert.equal(evaluate(output),evaluate(source));
 }
});

test('function binding compaction preserves captures, literal paths, fields and sibling calls',async()=>{
 const {compactFunctionBindings}=await import('../scripts/build-firestore-release-rules.mjs');
 const source=`function a() { return database; }
 function b(tenant) { let staff = get(/databases/$(database)/documents/staff/$(tenant)).data; return staff.tenantId == tenant && a() != null; }
 function c(inputValue) { let resultValue = inputValue.value; return b(resultValue) && inputValue . resultValue == 'inputValue'; }`;
 const result=compactFunctionBindings(source);
 assert.match(result,/documents\/staff\//);
 assert.match(result,/let staff =/);
 assert.match(result,/\$\(database\)/);
 assert.match(result,/return database;/);
 assert.match(result,/inputValue'/);
 assert.match(result,/\. resultValue/);
 assert.match(result,/b\(/);
 assert.equal(compactFunctionBindings(result),result);
});

test('binding compaction reuses names only within functions and preserves observable results',async()=>{
 const {compactFunctionBindings}=await import('../scripts/build-firestore-release-rules.mjs');
 const source=`function f(longArgument) { let longLocal = longArgument.amount; return longLocal > 0 && g(longArgument); }
 function g(otherArgument) { let otherLocal = otherArgument.limit; return otherArgument.amount <= otherLocal; }`;
 const result=compactFunctionBindings(source);
 assert.ok(result.length<source.length);
 for(const row of [{amount:1,limit:2},{amount:3,limit:2},{amount:0,limit:2},{amount:-1,limit:2},{amount:1}]){
  const run=(text:string)=>Function(text+'; return f(arguments[0]);')(row);
  assert.equal(run(result),run(source));
 }
});

test('shared value checks retain exact bounds and ignore literal text and longer expressions',async()=>{
 const {shareValueChecks}=await import('../scripts/build-firestore-release-rules.mjs');
 const source=`service cloud.firestore { match /databases/{database}/documents {
 function check(d) { return d.a is number && d.a >= 0 && d.b is number && d.b >= 0 && d.c is number && d.c >= 0 + 1; }
 // d.a is number && d.a >= 0
 function literal() { return 'd.a is number && d.a >= 0'; }
 match /rows/{id} { allow create: if check(request.resource.data); }
 } }`;
 const result=shareValueChecks(source);
 assert.match(result,/return value is number && value >= 0;/);
 assert.match(result,/d.c is number && d.c >= 0 \+ 1/);
 assert.match(result,/'d.a is number && d.a >= 0'/);
 assert.match(result,/\/\/ d.a is number && d.a >= 0/);
 assert.equal((result.match(/releaseValueCheck0\(d\./g)||[]).length,2);
});

test('single-use inlining preserves lazy invocation, captures, arguments and repeated helpers',async()=>{
 const {inlineSingleUseFunctions}=await import('../scripts/build-firestore-release-rules.mjs');
 const source=`function repeated() { return true; }
 function captured() { return outer; }
 function parameter(value) { return value; }
 function once() { return request.resource.data.value; }
 function check(outer, input) { return captured() && repeated() && repeated() && parameter(outer) && (outer ? once() : false); }`;
 const output=inlineSingleUseFunctions(source);
 assert.match(output,/function captured\(/);
 assert.match(output,/function parameter\(/);
 assert.match(output,/function repeated\(/);
 assert.doesNotMatch(output,/function once\(/);
 assert.match(output,/outer \? \( request.resource.data.value\)/);
 const simple=`function once() { return true; } function check() { return once(); }`;
 assert.doesNotMatch(inlineSingleUseFunctions(simple),/function once/);
 assert.equal(Function(inlineSingleUseFunctions(simple)+';return check();')(),true);
});

test('specialized paths remain idempotent and forwarding aliases preserve argument order',async()=>{
 const {shareSpecializedDocumentPaths,collapseAliasFunctions}=await import('../scripts/build-firestore-release-rules.mjs');
 const source=`service cloud.firestore { match /databases/{database}/documents {
 function repeated(id) { return ${Array.from({length:6},()=>"get(/databases/$(database)/documents/accounts/$(id)).data.enabled").join(' && ')}; }
 match /rows/{id} { allow read: if repeated(id); } } }`;
 const output=shareSpecializedDocumentPaths(source);
 assert.match(output,/documents\/accounts\/\$\(id\)/);
 assert.equal(shareSpecializedDocumentPaths(output),output);
 const wrapper='function target(a,b) { return a - b; } function forward(a,b) { return target(a,b); } function check() { return forward(5,2); }';
 const collapsed=collapseAliasFunctions(wrapper);
 assert.doesNotMatch(collapsed,/function forward/);
 assert.equal(Function(collapsed+'; return check();')(),3);
});

test('additional literal sharing preserves existing busy-path literal evaluation',async()=>{
 const {shareRepeatedStringValues}=await import('../scripts/build-firestore-release-rules.mjs');
 const source=`service cloud.firestore { match /databases/{database}/documents {
    function sensitive() { return 'busy_literal_with_long_policy_name' == 'busy_literal_with_long_policy_name'; }
    function quiet() { return 'quiet_literal_with_long_policy_name' == 'quiet_literal_with_long_policy_name'; }
    match /finance_transfers_v1/{id} { allow read: if sensitive(); }
    match /other/{id} { allow read: if quiet(); }
 } }`;
 const output=shareRepeatedStringValues(source);
 assert.match(output,/function sensitive\(\) \{ return 'busy_literal_with_long_policy_name' == 'busy_literal_with_long_policy_name';/);
 assert.match(output,/function quiet\(\) \{ return releaseStringValue\d+\(\) == releaseStringValue\d+\(\);/);
});
