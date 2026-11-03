import test from 'node:test';
import assert from 'node:assert/strict';
import {validateUnboundProbe} from '../scripts/firestore-unbound-probe.mjs';
const project='test-project',probeName='projects/test-project/releases/pharmhelm_size_probe_123_1',rulesetName='projects/test-project/rulesets/exact';
const input={project,token:'test-token',probeName,rulesetName,pause:async()=>{}};
const response=(status:number,data:any)=>new Response(JSON.stringify(data),{status});
test('unbound probe verifies exact candidate after ambiguous 503 acknowledgement',async()=>{
 const calls:any[]=[];let n=0;
 const result=await validateUnboundProbe({...input,fetchImpl:async(url:any,options:any)=>{calls.push({url,method:options.method});return n++===0?response(503,{}):response(200,{name:probeName,rulesetName});}});
 assert.equal(result.rulesetName,rulesetName);assert.deepEqual(calls.map(c=>c.method),['POST',undefined]);
});
test('unbound probe retries unavailable creation but still requires actual exact release',async()=>{
 let n=0;await validateUnboundProbe({...input,fetchImpl:async()=>[response(503,{}),response(404,{}),response(200,{name:probeName,rulesetName})][n++]});assert.equal(n,3);
});
test('unbound probe fails closed for persistent 503 with no verified release',async()=>{
 let n=0;await assert.rejects(validateUnboundProbe({...input,fetchImpl:async()=>response(n++%2?404:503,{})}),/not verified/);assert.equal(n,8);
});
test('unbound probe rejects compiled size errors without retrying or using another release',async()=>{
 let n=0;await assert.rejects(validateUnboundProbe({...input,fetchImpl:async()=>{n++;return response(400,{error:{message:'256300 bytes exceeds 256000'}});}}),/256300/);assert.equal(n,1);
});
test('unbound probe rejects conflicting candidate in successful response and recovery',async()=>{
 for(const recover of [false,true]){let n=0;await assert.rejects(validateUnboundProbe({...input,fetchImpl:async()=>recover&&n++===0?response(503,{}):response(200,{name:probeName,rulesetName:'projects/test-project/rulesets/other'})}),/Conflicting/);}
});
test('unbound probe refuses production release names before network access',async()=>{
 await assert.rejects(validateUnboundProbe({...input,probeName:'projects/test-project/releases/cloud.firestore',fetchImpl:async()=>{throw Error('Network must not be called');}}),/Unsafe/);
});
