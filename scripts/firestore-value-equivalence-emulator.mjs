import assert from 'node:assert/strict';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc} from 'firebase/firestore';
import {compactRuleSymbols,wrapReleaseColumns,RELEASE_RULE_OPTIONS} from './build-firestore-release-rules.mjs';
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Isolated emulator required.');
const guards=['d.value is int && d.value > 0','d.value is int && d.value >= 0',
 'd.value is number && d.value >= 0','d.value is number && d.value > 0',
 'd.value is string && d.value.size() > 0','d.value is string && d.value.size() >= 3',
 'd.value is string && d.value.size() >= 5','d.value is string && d.value.size() >= 8',
 'd.value is number && d.value >= 0 && d.value <= 100',
 'd.value is int && d.value >= 0 && d.value <= 9007199254740991',
 'd.value is string && d.value.size() >= 3 && d.value.size() <= 120'];
const values=[undefined,null,false,true,-1,0,1,3.5,100,101,9007199254740991,9007199254740992,'x'.repeat(120),'x'.repeat(121),'','ab','abc','abcde','abcdefgh',[],{},[1]];
let comparisons=0;
for(let index=0;index<guards.length;index++)for(const [context,wrap] of [p=>p,p=>`!(${p})`,p=>`(${p}) || true`,p=>`(${p}) == false`].entries()){
 const predicate=wrap(guards[index]);
 const rules=`rules_version = '2'; service cloud.firestore { match /databases/{database}/documents {
 function first(d) { return ${predicate}; } function second(d) { return ${predicate}; }
 match /cases/{id} { allow create: if first(request.resource.data); allow update: if second(request.resource.data); }
 } }`;
 const outcomes=[];
 for(const [variant,source] of [['authored',rules],['released',wrapReleaseColumns(compactRuleSymbols(rules,RELEASE_RULE_OPTIONS))]]){
  const env=await initializeTestEnvironment({projectId:`demo-value-${index}-${context}-${variant}`,firestore:{rules:source}});
  try{
   const db=env.authenticatedContext('actor').firestore(),decisions=[];
   for(let row=0;row<values.length;row++){
    const data=values[row]===undefined?{}:{value:values[row]};
    try{await setDoc(doc(db,'cases',String(row)),data);decisions.push(true);}
    catch(error){if(error.code!=='permission-denied')throw error;decisions.push(false);}
   }
   outcomes.push(decisions);
  }finally{await env.cleanup();}
 }
 assert.deepEqual(outcomes[1],outcomes[0],`Type/range ${index}, context ${context}`);
 comparisons+=values.length;
}
console.log(`PASS ${comparisons} authored/released type/range decisions with absent, malformed, numeric and string values in positive, negated and boolean contexts.`);
