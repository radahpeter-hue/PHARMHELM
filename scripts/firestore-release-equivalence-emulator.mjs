import assert from 'node:assert/strict';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {FieldPath,doc,setDoc,updateDoc,deleteDoc,getDoc,getDocs,collection,query,where} from 'firebase/firestore';
import {compactRuleSymbols,wrapReleaseColumns,RELEASE_RULE_OPTIONS} from './build-firestore-release-rules.mjs';

if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Firestore emulator is required.');
const source=`rules_version = '2'; service cloud.firestore {
  match /databases/{database}/documents {
    function tenant(id) { return request.auth != null && request.auth.token.tenantId == id; }
    function isAuthenticated() { return request.auth != null; }
    function isTenantMember(id) { return tenant(id); }
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
    match /gamma/{id} {
      allow read: if tenant(resource.data.tenantId);
      allow create: if editor() && tenant(request.resource.data.tenantId) && validKeys(request.resource.data) && activeTenant(request.resource.data.tenantId);
      allow update: if isAuthenticated() && editor() && isTenantMember(resource.data.tenantId) && isTenantMember(request.resource.data.tenantId)
        && request.resource.data.tenantId == resource.data.tenantId && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['value','note','reference','tenantId']);
      allow delete: if editor() && tenant(resource.data.tenantId);
    }
    match /deny_only/{id} { allow read, write: if false; }
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
   for(const name of ['alpha','beta','gamma'])for(const action of ['get','list','create','extra','update','extraUpdate','move','delete']){
    const id='case_'+index+'_'+action,ref=doc(db,name,id);
    if(!['create','extra'].includes(action))await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),name,id),{tenantId:'a',value:1}));
    const operation=action==='get'?getDoc(ref):action==='list'?getDocs(query(collection(db,name),where('tenantId','==','a'))):action==='create'?setDoc(ref,{tenantId:'a',value:1}):action==='extra'?setDoc(ref,{tenantId:'a',value:1,'tenantId~value':2}):action==='delete'?deleteDoc(ref):action==='extraUpdate'?updateDoc(ref,new FieldPath('tenantId~value'),2):updateDoc(ref,action==='move'?{tenantId:'b'}:{value:2});
    const result=await allowed(operation);
    const expected=Boolean(actor?.tenantId==='a'&&(action==='get'||action==='list'||(['editor','manager','owner','admin'].includes(actor.role)&&!['move','extra','extraUpdate'].includes(action))));
    assert.equal(result,expected,`${label}: ${index}/${name}/${action}`);decisions.push(result);
   }
   for(const name of ['alpha_extra','Beta','unrelated','deny_only']){
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
const released=await evaluate(wrapReleaseColumns(compactRuleSymbols(source,RELEASE_RULE_OPTIONS)),'released');
assert.deepEqual(released,original);
console.log(`PASS ${released.length} original/released authorization decisions: roles, tenants, queries, collection isolation, update ownership and wildcard permissions.`);

// Compare the actual shared identity predicate with its previous scalar form.
const {readFileSync}=await import('node:fs');
const {execFileSync}=await import('node:child_process');
const identityDefinition=/function preservesExistingField\(key\) \{([\s\S]*?)\n    \}/;
// Cash CI compacts the root file in place. Git supplies the exact authored HEAD.
const identityBody=(readFileSync('firestore.rules','utf8').match(identityDefinition)
 || execFileSync('git',['show','HEAD:firestore.rules'],{encoding:'utf8'}).match(identityDefinition))?.[1];
if(!identityBody)throw Error('Identity guard fixture missing.');
const identityValues=[undefined,null,false,0,1,'','code',[],{},['code']];
let identityComparisons=0;
for(const [context,wrap]of [p=>p,p=>`!(${p})`,p=>`(${p}) || true`,p=>`(${p}) == false`].entries()){
 const outcomes=[];
 for(const variant of ['scalar','shared','released']){
  const predicate=wrap(variant==='scalar'?"!('identity' in resource.data) || request.resource.data.identity == resource.data.identity":"preservesExistingField('identity')");
  const rules=`rules_version = '2';service cloud.firestore {match /databases/{database}/documents {function preservesExistingField(key){${identityBody}} match /identity/{id}{allow write: if ${predicate};}}}`;
  const testedRules=variant==='released'?wrapReleaseColumns(compactRuleSymbols(rules,RELEASE_RULE_OPTIONS)):rules;
  const env=await initializeTestEnvironment({projectId:`demo-preserve-${context}-${variant}`,firestore:{rules:testedRules}}),decisions=[];
  const allowed=async operation=>{try{await operation;return true;}catch(error){if(error.code==='permission-denied')return false;throw error;}};
  try{
   const db=env.authenticatedContext('actor').firestore();let id=0;
   const data=value=>value===undefined?{}:{identity:value};
   for(const before of identityValues)for(const after of identityValues){
    const ref=doc(db,'identity',String(id++));
    await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'identity',ref.id),data(before)));
    decisions.push(await allowed(setDoc(ref,data(after))));
   }
   for(const before of identityValues){
    const ref=doc(db,'identity',String(id++));
    await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'identity',ref.id),data(before)));
    decisions.push(await allowed(deleteDoc(ref)));
   }
   for(const after of identityValues)decisions.push(await allowed(setDoc(doc(db,'identity',String(id++)),data(after))));
   outcomes.push(decisions);
  }finally{await env.cleanup();}
 }
 assert.deepEqual(outcomes[1],outcomes[0],`Existing identity context ${context}`);assert.deepEqual(outcomes[2],outcomes[0],`Released identity context ${context}`);identityComparisons+=outcomes[0].length;
}
console.log(`PASS ${identityComparisons} scalar/shared/released identity cases: absent, null, malformed, retained, changed and removed values; create/update/delete; positive/negated/boolean contexts.`);

// A local helper may reuse an unused global name; global callees retain lexical scope.
const {compactLocalFunctionNames}=await import('./build-firestore-release-rules.mjs');
const lexicalSource=`rules_version='2';service cloud.firestore {match /databases/{database}/documents {
 function a(){return false;} function b(){return a();}
 match /deny/{c}{function longDeny(d){return d.id==c;} allow create:if b() && longDeny(request.resource.data);}
 match /allow/{c}{function longAllow(d){return d.id==c;} allow create:if !b() && longAllow(request.resource.data);}
}}`;
let lexicalCases=0;
for(const [variant,source]of [['authored',lexicalSource],['local',compactLocalFunctionNames(lexicalSource)],['released',wrapReleaseColumns(compactRuleSymbols(lexicalSource,RELEASE_RULE_OPTIONS))]]){
 const env=await initializeTestEnvironment({projectId:'demo-local-functions-'+variant,firestore:{rules:source}});
 try{
  const db=env.authenticatedContext('actor').firestore();
  for(const name of ['deny','allow'])for(const id of ['match','other']){
   let permitted=true;
   try{await setDoc(doc(db,name,'match'),{id});}catch(error){if(error.code!=='permission-denied')throw error;permitted=false;}
   assert.equal(permitted,name==='allow'&&id==='match',`${variant}/${name}/${id}`);lexicalCases++;
  }
 }finally{await env.cleanup();}
}
console.log(`PASS ${lexicalCases} global/local lexical binding and wildcard capture cases.`);

// Collection families with different policies must not inherit one another's grants.
const {groupEquivalentCollections}=await import('./build-firestore-release-rules.mjs');
const familySource=`rules_version='2';service cloud.firestore {match /databases/{database}/documents {
    match /readA/{id} {allow read:if request.auth!=null && resource.data.tenant==request.auth.token.tenantId;}
    match /readB/{id} {allow read:if request.auth!=null && resource.data.tenant==request.auth.token.tenantId;}
    match /writeA/{id} {allow create:if request.auth!=null && request.auth.uid=='editor' && request.resource.data.tenant==request.auth.token.tenantId;}
    match /writeB/{id} {allow create:if request.auth!=null && request.auth.uid=='editor' && request.resource.data.tenant==request.auth.token.tenantId;}
}}`;
let familyCases=0;
for(const [variant,source]of [['authored',familySource],['grouped',groupEquivalentCollections(familySource)],['released',wrapReleaseColumns(compactRuleSymbols(familySource,RELEASE_RULE_OPTIONS))]]){
 const env=await initializeTestEnvironment({projectId:'demo-policy-families-'+variant,firestore:{rules:source}});
 try{
  for(const actor of [null,{uid:'editor',tenantId:'a'},{uid:'viewer',tenantId:'a'},{uid:'foreign',tenantId:'b'}]){
   const db=(actor?env.authenticatedContext(actor.uid,{tenantId:actor.tenantId}):env.unauthenticatedContext()).firestore();
   for(const name of ['readA','readB','writeA','writeB','readA_extra','unrelated'])for(const method of ['get','list','create','delete']){
    const ref=doc(db,name,(actor?.uid||'anonymous')+'_'+method);
    if(method!=='create')await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),name,ref.id),{tenant:'a'}));
    let permitted=true;
    try{await(method==='get'?getDoc(ref):method==='list'?getDocs(query(collection(db,name),where('tenant','==','a'))):method==='create'?setDoc(ref,{tenant:'a'}):deleteDoc(ref));}
    catch(error){if(error.code!=='permission-denied')throw error;permitted=false;}
    const expected=Boolean(actor?.tenantId==='a'&&(['readA','readB'].includes(name)&&['get','list'].includes(method)||actor.uid==='editor'&&['writeA','writeB'].includes(name)&&method==='create'));
    assert.equal(permitted,expected,`${variant}/${actor?.uid}/${name}/${method}`);familyCases++;
   }
  }
 }finally{await env.cleanup();}
}
console.log(`PASS ${familyCases} independent policy-family, tenant, method, query and prefix-isolation decisions.`);
