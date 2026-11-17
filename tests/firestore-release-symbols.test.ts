import test from 'node:test';
import assert from 'node:assert/strict';
import {bindWriteSnapshots,compactRuleSymbols,shareRepeatedAllowConditions,shareRequestExpressions,localizeCollectionHelpers,balanceBooleanChains,shareDocumentPaths,memoizeRequiredExpressions} from '../scripts/build-firestore-release-rules.mjs';
test('required expression reuse preserves accepted values and rejection of missing required fields',()=>{
 const source='function permitted(row) { return row.amount > 0 && row.amount < 10 && row.amount != 4 && row.amount != 5; }';
 const transformed=memoizeRequiredExpressions(source);
 assert.ok(transformed.includes('let releaseMemo'));
 const run=(text:string,row:any)=>{try{return Function(text+'; return permitted(arguments[0]);')(row)===true;}catch{return false;}};
 for(const value of [null,{},...Array.from({length:14},(_,amount)=>({amount}))])assert.equal(run(transformed,value),run(source,value));
 assert.equal(memoizeRequiredExpressions(transformed),transformed);
});
test('memoization leaves optional OR and ternary branches lazy and respects the ten-binding limit',()=>{
 for(const source of [
  'function permitted(row) { return row == null || row.amount > 0 || row.amount < 10 || row.amount == 3 || row.amount == 4; }',
  'function permitted(row) { return row == null ? true : row.amount > 0 && row.amount < 10 && row.amount != 4 && row.amount != 5; }',
  'function permitted(row) { '+Array.from({length:10},(_,i)=>`let value${i} = ${i};`).join(' ')+' return row.amount > 0 && row.amount < 10 && row.amount != 4 && row.amount != 5; }',
 ])assert.equal(memoizeRequiredExpressions(source),source);
});
test('document path sharing preserves collection, ID expressions, snapshot method and deeper paths',()=>{
 const source=`service cloud.firestore { match /databases/{database}/documents {
 function evidence(id) { return getAfter(/databases/$(database)/documents/accounts/$(id)).data; }
 match /debts/{id} { allow update: if get(/databases/$(database)/documents/sales/$(request.resource.data.get('saleId', id))).data.amount > 0; }
 match /nested/{id} { allow get: if exists(/databases/$(database)/documents/sales/$(id)/items/$(id)); }
 // get(/databases/$(database)/documents/ignored/$(id))
} }`;
 const result=shareDocumentPaths(source);
 assert.ok(result.includes("releaseDocumentPathAfter('accounts',id)"));
 assert.ok(result.includes("releaseDocumentPathBefore('sales',request.resource.data.get('saleId', id))"));
 assert.ok(result.includes('return getAfter(/databases/$(database)/documents/$(collection)/$(id)).data;'));
 assert.ok(result.includes('return get(/databases/$(database)/documents/$(collection)/$(id)).data;'));
 assert.ok(result.includes('exists(/databases/$(database)/documents/sales/$(id)/items/$(id))'));
 assert.ok(result.includes('// get(/databases/$(database)/documents/ignored/$(id))'));
 assert.equal(shareDocumentPaths(result),result);
});
test('balanced boolean chains preserve results and exact short-circuit operand order',()=>{
 for(const operator of ['&&','||']){
  const expression=Array.from({length:16},(_,index)=>`check(${index})`).join(operator);
  const transformed=balanceBooleanChains('return '+expression+';');
  assert.notEqual(transformed,'return '+expression+';');
  for(let stop=0;stop<=16;stop++){
   const evaluate=(body:string)=>{const calls:number[]=[];const value=Function('check',body)((index:number)=>{calls.push(index);return operator==='&&'?index!==stop:index===stop;});return {value,calls};};
   assert.deepEqual(evaluate(transformed),evaluate('return '+expression+';'));
  }
  assert.equal(balanceBooleanChains(transformed),transformed);
 }
});
test('boolean balancing respects ternaries, argument boundaries, strings and mixed precedence',()=>{
 const expression="choose(true, false) ? (a || b && c && d && e && f && g && h && i && j) : 'literal && || ;'";
 const transformed=balanceBooleanChains('return '+expression+';');
 for(let bits=0;bits<1024;bits++){
  const values=Array.from({length:10},(_,i)=>Boolean(bits&(1<<i)));
  const evaluate=(body:string)=>Function('choose','a','b','c','d','e','f','g','h','i','j',body)((a:boolean)=>a,...values);
  assert.equal(evaluate(transformed),evaluate('return '+expression+';'));
 }
 assert.ok(transformed.includes('choose(true, false)'));
 assert.ok(transformed.includes("'literal && || ;'"));
});
test('collection helpers and their dependency chain move together while shared helpers remain inherited',()=>{
 const source=`service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }
    function positive(value) { return value > 0; }
    function validDebt() { return signedIn() && positive(request.resource.data.amount); }
    match /debts/{id} {
      allow create: if validDebt();
    }
    match /users/{id} {
      allow read: if signedIn();
    }
  }
}`;
 const result=localizeCollectionHelpers(source),debt=result.indexOf('match /debts/');
 assert.ok(result.indexOf('function signedIn')<debt);
 assert.ok(result.indexOf('function positive')>debt);
 assert.ok(result.indexOf('function validDebt')>debt);
 assert.ok(result.indexOf('function validDebt')<result.indexOf('allow create'));
 assert.equal((result.match(/allow /g)||[]).length,2);
 assert.equal(localizeCollectionHelpers(result),result);
});
test('localization preserves lexical binding when a destination declares a conflicting helper',()=>{
 const source=`service cloud.firestore {
  match /databases/{database}/documents {
    function shared() { return true; }
    function specific() { return shared(); }
    match /debts/{id} {
      function shared() { return false; }
      allow create: if specific();
    }
  }
}`;
 assert.equal(localizeCollectionHelpers(source),source);
});
test('a retained root helper keeps its dependency chain accessible at root',()=>{
 const source=`service cloud.firestore {
  match /databases/{database}/documents {
    function positive(value) { return value > 0; }
    function validDebt() { return positive(request.resource.data.amount); }
    match /debts/{id} {
      function unrelated() { let amount = 1; return amount; }
      allow create: if validDebt();
    }
  }
}`;
 assert.equal(localizeCollectionHelpers(source),source);
});
test('bounded multi-collection helpers retain the same call chain in every owning match',()=>{
 const source=`service cloud.firestore {
  match /databases/{database}/documents {
    function positive(value) { return value > 0; }
    function validDebt() { return positive(request.resource.data.amount); }
    match /debts/{id} {
      allow create: if validDebt();
    }
    match /invoices/{id} {
      allow create: if validDebt();
    }
  }
}`;
 const result=localizeCollectionHelpers(source,6);
 assert.equal((result.match(/function positive/g)||[]).length,2);
 assert.equal((result.match(/function validDebt/g)||[]).length,2);
 assert.ok(result.indexOf('function positive')>result.indexOf('match /debts/'));
 assert.ok(result.lastIndexOf('function positive')>result.indexOf('match /invoices/'));
 assert.equal((result.match(/allow create: if validDebt\(\);/g)||[]).length,2);
 assert.equal(localizeCollectionHelpers(result,6),result);
});
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


test('identical grants share a predicate while match-specific variables and local functions stay scoped', () => {
 const source = `service cloud.firestore {
  match /databases/{database}/documents {
    match /first/{id} {
      function local() { return id == 'first'; }
      allow get: if isAuthenticated() && resource != null && resource.data.tenantId == 'tenant';
      allow update: if isAuthenticated() && resource != null && local() && id == 'first';
    }
    match /second/{id} {
      function local() { return id == 'second'; }
      allow list: if isAuthenticated() && resource != null && resource.data.tenantId == 'tenant';
      allow update: if isAuthenticated() && resource != null && local() && id == 'first';
    }
  }
 }`;
 const shared = shareRepeatedAllowConditions(source);
 const helper = shared.match(/function (releaseSharedAllow\d+)\(\)/)?.[1];
 assert.ok(helper);
 assert.equal(shared.match(new RegExp('function ' + helper, 'g'))?.length, 1);
 assert.ok(shared.includes('allow get: if ' + helper + '();'));
 assert.ok(shared.includes('allow list: if ' + helper + '();'));
 assert.equal(shared.match(/allow update: if isAuthenticated\(\) && resource != null && local\(\) && id == 'first';/g)?.length, 2);
});

test('request paths become lazy calls and strings and comments are preserved', () => {
 const source = `service cloud.firestore { match /databases/{database}/documents {
  // request.resource.data is not executable here
  match /items/{id} { allow get: if resource == null || resource.data.note == 'request.auth.uid';
  allow create: if request.auth != null && request.resource.data.uid == request.auth.uid;
  }
 } }`;
 const output = shareRequestExpressions(source);
 assert.ok(output.includes("// request.resource.data is not executable here"));
 assert.ok(output.includes("== 'request.auth.uid'"));
 assert.match(output, /resource == null \|\| releaseRequestPath\d+\(\)\.note/);
 assert.match(output, /request\.auth != null && releaseRequestPath\d+\(\)\.uid == releaseRequestPath\d+\(\)/);
 assert.match(output, /return request\.auth\.uid;/);
 assert.match(output, /return request\.resource\.data;/);
});

test('local bindings cannot rename Firestore rule methods', () => {
 const source = `service cloud.firestore { match /databases/{database}/documents {
  function isAllowed() { let write = true; return write; }
  match /items/{id} { allow read, write: if isAllowed(); }
 } }`;
 assert.match(compactRuleSymbols(source), /allow read, write: if /);
});

test('frequent snapshot fields share their full lazy paths', () => {
 const source = `service cloud.firestore { match /databases/{database}/documents {
  match /items/{id} { allow get: if resource == null || resource.data.tenantId == 't';
  allow create: if request.resource.data.tenantId == 't' && request.resource.data.branchId == 'b'; }
 } }`;
 const output = shareRequestExpressions(source);
 for (const path of ['resource.data.tenantId','request.resource.data.tenantId','request.resource.data.branchId']) {
  assert.ok(output.includes('return ' + path + ';'));
 }
 assert.match(output, /resource == null \|\| releaseRequestPath\d+\(\) == 't'/);
});
