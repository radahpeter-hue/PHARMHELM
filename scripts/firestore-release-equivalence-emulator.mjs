import assert from 'node:assert/strict';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc,deleteDoc,getDoc,getDocs,collection,query,where} from 'firebase/firestore';
import {compactRuleSymbols,wrapReleaseColumns} from './build-firestore-release-rules.mjs';

if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Firestore emulator is required.');
const source=`rules_version = '2'; service cloud.firestore {
  match /databases/{database}/documents {
    function tenant(id) { return request.auth != null && request.auth.token.tenantId == id; }
    function editor() { return request.auth != null && request.auth.token.role == 'editor'; }
    match /alpha/{id} {
      allow read: if tenant(resource.data.tenantId);
      allow create: if editor() && tenant(request.resource.data.tenantId);
      allow update: if editor() && tenant(resource.data.tenantId) && tenant(request.resource.data.tenantId);
      allow delete: if editor() && tenant(resource.data.tenantId);
    }
    match /beta/{other} {
      allow read: if tenant(resource.data.tenantId);
      allow create: if editor() && tenant(request.resource.data.tenantId);
      allow update: if editor() && tenant(resource.data.tenantId) && tenant(request.resource.data.tenantId);
      allow delete: if editor() && tenant(resource.data.tenantId);
    }
    match /special/{id} {
      allow get: if id == 'public';
    }
  }
}`;
const actors=[null,{role:'viewer',tenantId:'a'},{role:'editor',tenantId:'a'},{role:'editor',tenantId:'b'}];
async function evaluate(rules,label){
 const env=await initializeTestEnvironment({projectId:'demo-release-equivalence-'+label,firestore:{rules}});
 const decisions=[];
 const allowed=async operation=>{try{await operation;return true;}catch(error){if(error.code==='permission-denied')return false;throw error;}};
 try{
  await env.clearFirestore();
  for(const [index,actor] of actors.entries()){
   const db=(actor?env.authenticatedContext('actor_'+index,actor):env.unauthenticatedContext()).firestore();
   for(const name of ['alpha','beta'])for(const action of ['get','list','create','update','move','delete']){
    const id='case_'+index+'_'+action,ref=doc(db,name,id);
    if(action!=='create')await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),name,id),{tenantId:'a',value:1}));
    const operation=action==='get'?getDoc(ref):action==='list'?getDocs(query(collection(db,name),where('tenantId','==','a'))):action==='create'?setDoc(ref,{tenantId:'a',value:1}):action==='delete'?deleteDoc(ref):updateDoc(ref,action==='move'?{tenantId:'b'}:{value:2});
    const result=await allowed(operation);
    const expected=Boolean(actor?.tenantId==='a'&&(action==='get'||action==='list'||(actor.role==='editor'&&action!=='move')));
    assert.equal(result,expected,`${label}: ${index}/${name}/${action}`);decisions.push(result);
   }
   for(const name of ['alpha_extra','Beta','unrelated']){
    const result=await allowed(setDoc(doc(db,name,'new'),{tenantId:'a'}));
    assert.equal(result,false,`${label}: collection isolation ${name}`);decisions.push(result);
   }
   const special=await allowed(getDoc(doc(db,'special','public')));
   assert.equal(special,true,`${label}: wildcard-specific permission`);decisions.push(special);
  }
  return decisions;
 }finally{await env.cleanup();}
}
const original=await evaluate(source,'original');
const released=await evaluate(wrapReleaseColumns(compactRuleSymbols(source)),'released');
assert.deepEqual(released,original);
console.log(`PASS ${released.length} original/released authorization decisions: roles, tenants, queries, collection isolation, update ownership and wildcard permissions.`);
