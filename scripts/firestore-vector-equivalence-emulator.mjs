import assert from 'node:assert/strict';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc} from 'firebase/firestore';
import {packEqualityConjunctions} from './build-firestore-release-rules.mjs';
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Isolated emulator required.');
const predicates=[
 'd.enabled ? d.a == 1 && d.b == 2 && d.c == 3 : false',
 'd.enabled ? d.a == 1 && d.b == 2 && d.c == 3 : d.a == 1 && d.b == 2 && d.c == 3',
 'd.a == 1 && d.b == 2 && d.c == 3',
 'd.a == 1 && d.enabled && d.b == 2 && d.c == 3',
 'd.a == 1 && false && d.b == 2 && d.c == 3',
 'd.a == 1 && d.b == 2 && d.c == 3 && false',
 'd.a == d.other && d.b == 2 && d.c == 3',
];
const payloads=[{}, {a:0}, {a:1}, {a:0,b:2,c:3,enabled:false}, {a:1,b:2,c:3,enabled:true}, {a:1,b:2,c:3,enabled:false}, {a:1,b:2,c:3}, {a:1,b:null,c:3,enabled:true}, {a:1,b:'2',c:3,enabled:true}, {a:1,b:2,c:3,other:1,enabled:true}, {a:[1],b:2,c:3,other:[1],enabled:true}];
for(let index=0;index<predicates.length;index++){
 const contexts=[p=>p,p=>`!(${p})`,p=>`(${p}) || true`,p=>`(${p}) == false`,p=>`(${p}) && false`];
 for(let context=0;context<contexts.length;context++){
  const condition=contexts[context](predicates[index]);
  const rules=`rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { function permitted(d) { return ${condition}; } match /cases/{id} { allow create: if permitted(request.resource.data); } } }`;
  const outcomes=[];
  for(const [variant,text] of [['authored',rules],['packed',packEqualityConjunctions(rules,{booleanChoices:true})]]){
   const env=await initializeTestEnvironment({projectId:`demo-vector-${index}-${context}-${variant}`,firestore:{rules:text}});
   try{const db=env.authenticatedContext('actor').firestore(); const results=[];for(let row=0;row<payloads.length;row++){
    try{await setDoc(doc(db,'cases',String(row)),payloads[row]);results.push(true);}catch(error){if(error.code!=='permission-denied')throw error;results.push(false);}
   } outcomes.push(results);}finally{await env.cleanup();}
  }
  assert.deepEqual(outcomes[1],outcomes[0],`Predicate ${index}, context ${context}`);
 }
}
console.log('Vector comparison matches authored permissions for 385 valid, missing-field and malformed cases in positive, negated and boolean contexts.');
