import assert from 'node:assert/strict';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc,deleteDoc,getDoc,getDocs,collection,query,where} from 'firebase/firestore';
import {compactRuleSymbols,wrapReleaseColumns} from './build-firestore-release-rules.mjs';

if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Firestore emulator is required.');
const source=`rules_version = '2'; service cloud.firestore {
  match /databases/{database}/documents {
    function tenant(id) { return request.auth != null && request.auth.token.tenantId == id; }
    function editor() { return request.auth != null && request.auth.token.role in ['editor','manager','owner','admin']; }
    function ownerPath(id) { return /databases/$(database)/documents/owners/$(id); }
    function activeTenant(id) { let path = ownerPath(id); return get(path).data.enabled && getAfter(path).data.enabled; }
    function validKeys(data) { return data.keys().hasOnly(['tenantId','value','note','reference']); }
    match /alpha/{id} {
      allow read: if tenant(resource.data.tenantId);
      allow create: if editor() && tenant(request.resource.data.tenantId) && validKeys(request.resource.data) && activeTenant(request.resource.data.tenantId);
      allow update: if editor() && tenant(resource.data.tenantId) && tenant(request.resource.data.tenantId) && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['value','note','reference','tenantId']);
      allow delete: if editor() && tenant(resource.data.tenantId);
    }
    match /beta/{other} {
      allow read: if tenant(resource.data.tenantId);
      allow create: if editor() && tenant(request.resource.data.tenantId) && validKeys(request.resource.data) && activeTenant(request.resource.data.tenantId);
      allow update: if editor() && tenant(resource.data.tenantId) && tenant(request.resource.data.tenantId) && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['value','note','reference','tenantId']);
      allow delete: if editor() && tenant(resource.data.tenantId);
    }
    match /special/{id} {
      allow get: if id == 'public';
    }
  }
}`;
const actors=[null,{role:'viewer',tenantId:'a'},{role:'editor',tenantId:'a'},{role:'editor',tenantId:'b'},{role:'manager',tenantId:'a'},{role:'editor~manager',tenantId:'a'}];
async function evaluate(rules,label){
 const env=await initializeTestEnvironment({projectId:'demo-release-equivalence-'+label,firestore:{rules}});
 const decisions=[];
 const allowed=async operation=>{try{await operation;return true;}catch(error){if(error.code==='permission-denied')return false;throw error;}};
 try{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx=>{for(const id of ['a','b'])await setDoc(doc(ctx.firestore(),'owners',id),{enabled:true});});
  for(const [index,actor] of actors.entries()){
   const db=(actor?env.authenticatedContext('actor_'+index,actor):env.unauthenticatedContext()).firestore();
   for(const name of ['alpha','beta'])for(const action of ['get','list','create','extra','update','extraUpdate','move','delete']){
    const id='case_'+index+'_'+action,ref=doc(db,name,id);
    if(!['create','extra'].includes(action))await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),name,id),{tenantId:'a',value:1}));
    const operation=action==='get'?getDoc(ref):action==='list'?getDocs(query(collection(db,name),where('tenantId','==','a'))):action==='create'?setDoc(ref,{tenantId:'a',value:1}):action==='extra'?setDoc(ref,{tenantId:'a',value:1,'tenantId~value':2}):action==='delete'?deleteDoc(ref):updateDoc(ref,action==='extraUpdate'?{'tenantId~value':2}:action==='move'?{tenantId:'b'}:{value:2});
    const result=await allowed(operation);
    const expected=Boolean(actor?.tenantId==='a'&&(action==='get'||action==='list'||(['editor','manager','owner','admin'].includes(actor.role)&&!['move','extra','extraUpdate'].includes(action))));
    assert.equal(result,expected,`${label}: ${index}/${name}/${action}`);decisions.push(result);
   }
   for(const name of ['alpha_extra','Beta','unrelated']){
    const result=await allowed(setDoc(doc(db,name,'new'),{tenantId:'a'}));
    assert.equal(result,false,`${label}: collection isolation ${name}`);decisions.push(result);
   }
   const special=await allowed(getDoc(doc(db,'special','public')));
   assert.equal(special,true,`${label}: wildcard-specific permission`);decisions.push(special);
  }
  await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),'owners','a'),{enabled:false}));
  for(const tenantId of ['a','missing']){
   const db=env.authenticatedContext('blocked_'+tenantId,{tenantId,role:'editor'}).firestore();
   const result=await allowed(setDoc(doc(db,'alpha','blocked_'+tenantId),{tenantId,value:1}));
   assert.equal(result,false,`${label}: inactive or missing owner`);decisions.push(result);
  }
  return decisions;
 }finally{await env.cleanup();}
}
const original=await evaluate(source,'original');
const released=await evaluate(wrapReleaseColumns(compactRuleSymbols(source)),'released');
assert.deepEqual(released,original);
console.log(`PASS ${released.length} original/released authorization decisions: roles, tenants, queries, collection isolation, update ownership and wildcard permissions.`);
