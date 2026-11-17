import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseCompiler} from '../scripts/diagnose-firestore-compiler.mjs';
const response=(status:number,data:any={})=>new Response(JSON.stringify(data),{status});
const input={project:'test-project',token:'test-token',runId:123,controls:[{label:'base',source:'deny-all'}],log:()=>{}};
test('compiler controls report 503 without certifying or releasing an unavailable ruleset',async()=>{
 const calls:any[]=[];
 const result=await diagnoseCompiler({...input,fetchImpl:async(url:any,options:any)=>{calls.push({url,options});return response(503,{error:{message:'unavailable'}});}});
 assert.equal(result[0].compilerStatus,503);assert.equal(result[0].exactProbeVerified,undefined);assert.equal(calls.length,1);
});
test('compiler control verifies exact unbound probe after ambiguous failure and cleans only its own artifacts',async()=>{
 const rulesetName='projects/test-project/rulesets/control',name='projects/test-project/releases/pharmhelm_size_probe_123_100';
 const replies=[response(200,{name:rulesetName}),response(503),response(200,{name,rulesetName}),response(200),response(200)];
 const calls:any[]=[];
 const result=await diagnoseCompiler({...input,fetchImpl:async(url:any,options:any)=>{calls.push({url,method:options.method});return replies.shift();}});
 assert.equal(result[0].exactProbeVerified,true);
 assert.deepEqual(calls.filter(c=>c.method==='DELETE').map(c=>c.url),[name,rulesetName].map(n=>'https://firebaserules.googleapis.com/v1/'+n));
 assert.ok(calls.every(c=>!c.url.includes('/cloud.firestore')));
});
test('compiler diagnostics continue to the second control after a failure',async()=>{
 const result=await diagnoseCompiler({...input,controls:[...input.controls,...input.controls],fetchImpl:async()=>response(503)});
 assert.equal(result.length,2);assert.ok(result.every((r:any)=>r.compilerStatus===503));
});
