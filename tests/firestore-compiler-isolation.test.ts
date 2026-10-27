import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {permissionSites,isolateCompilerControls} from '../scripts/isolate-firestore-compiler.mjs';
const source=`rules_version = '2'; service cloud.firestore { match /databases/{database}/documents {
 function trusted() { return request.auth != null; }
 // allow write: if true; and match /fake/{id} { }
 match /clients/{id} { allow read: if trusted(); match /history/{entry} { allow create: if false; } }
 match /finance_events/{id} { function note() { return 'allow write: if true;'; } allow write: if trusted(); }
 match /{collectionName}/{docId} { allow read: if false; }
} }`;
test('isolation parses captures and nested matches without treating quoted/commented permissions as code',()=>{
 const p=permissionSites(source);assert.equal(p.sites.length,4);assert.equal(p.sites[0].group,'/clients/{id}');assert.equal(p.sites[1].group,'/clients/{id}');
 const c=isolateCompilerControls(source);const a=c.find(x=>x.name==='first-half')!,b=c.find(x=>x.name==='second-half')!;
 assert.equal(a.retainedPermissions+b.retainedPermissions,4);assert.ok(!a.groups.some(x=>b.groups.includes(x)));
 assert.equal(c.find(x=>x.name==='all-denied')!.retainedPermissions,0);
 assert.equal(c.find(x=>x.name==='credit-pos-crm')!.retainedPermissions,2);
 assert.equal(c.find(x=>x.name==='finance-payroll')!.retainedPermissions,1);
 for(const x of c){assert.match(x.rules,/request.auth != null/);assert.match(x.rules,/'allow write: if true;'/);assert.equal(permissionSites(x.rules).sites.length,4);}
});
test('real application controls partition every permission once and retain only original or deny-all expressions',()=>{
 const s=readFileSync('firestore.rules','utf8'),p=permissionSites(s),c=isolateCompilerControls(s);
 assert.ok(p.sites.length>100);assert.equal(c[0].retainedPermissions+c[1].retainedPermissions,p.sites.length);
 for(const x of c)assert.equal(permissionSites(x.rules).sites.length,p.sites.length);
 const denied=c.find(x=>x.name==='all-denied')!.rules;const d=permissionSites(denied);
 for(const x of d.sites)assert.equal(d.tokens.slice(x.start,x.end+1).join('').replace(/\s/g,''),'allowread,write:iffalse;');
});
