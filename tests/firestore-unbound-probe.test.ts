import test from 'node:test';
import assert from 'node:assert/strict';
import {validateUnboundProbe,validateExactCandidateProbe,findExactInactiveRuleset,fetchRulesApi} from '../scripts/firestore-unbound-probe.mjs';
const project='test-project',probeName='projects/test-project/releases/pharmhelm_size_probe_123_1',rulesetName='projects/test-project/rulesets/exact';
const input={project,token:'test-token',probeName,rulesetName,pause:async()=>{}};
const response=(status:number,data:any)=>new Response(JSON.stringify(data),{status});
test('ambiguous compilation recovery requires exact source and does not create or activate releases',async()=>{
 const calls:any[]=[];const saved={name:rulesetName,source:{files:[{name:'firestore.rules',content:'exact input'}]}};
 const replies=[response(200,{rulesets:[{name:rulesetName}]}),response(200,saved)];
 assert.deepEqual(await findExactInactiveRuleset({project,token:'test',rules:'exact input',fetchImpl:async(url:any,options:any)=>{calls.push({url,options});return replies.shift();}}),saved);
 assert.ok(calls.every(call=>!call.options.method&&!call.url.includes('/releases/')));
});
test('ruleset recovery rejects similar input, unexpected file envelopes and cross-project identities',async()=>{
 const calls:any[]=[];
 const result=await findExactInactiveRuleset({project,token:'test',rules:'exact',fetchImpl:async(url:any)=>{calls.push(url);return calls.length===1?response(200,{rulesets:[{name:'projects/foreign/rulesets/x'},{name:rulesetName}]}):response(200,{name:rulesetName,source:{files:[{name:'firestore.rules',content:'different'}]}});}});
 assert.equal(result,null);assert.equal(calls.length,2);assert.ok(calls.every(url=>!url.includes('foreign')));
});
test('unbound probe verifies exact candidate after ambiguous 503 acknowledgement',async()=>{
 const calls:any[]=[];let n=0;
 const result=await validateUnboundProbe({...input,fetchImpl:async(url:any,options:any)=>{calls.push({url,method:options.method});return n++===0?response(503,{}):response(200,{name:probeName,rulesetName});}});
 assert.equal(result.rulesetName,rulesetName);assert.deepEqual(calls.map(c=>c.method),['POST',undefined]);
});
test('unbound probe retries unavailable creation but still requires actual exact release',async()=>{
 let n=0;await validateUnboundProbe({...input,fetchImpl:async()=>[response(503,{}),response(404,{}),response(200,{name:probeName,rulesetName})][n++]});assert.equal(n,3);
});
test('unbound probe fails closed for persistent 503 with no verified release',async()=>{
 let n=0;await assert.rejects(validateUnboundProbe({...input,fetchImpl:async()=>response(n++%2?404:503,{})}),/not verified/);assert.equal(n,12);
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

test('delayed acknowledgement verifies only the exact candidate after the final POST retry',async()=>{
 let calls=0;const methods:any[]=[];
 const result=await validateUnboundProbe({...input,fetchImpl:async(_url:any,options:any)=>{
  methods.push(options.method || 'GET');calls++;
  return calls>9?response(200,{name:probeName,rulesetName}):response(options.method==='POST'?503:404,{});
 }});
 assert.equal(result.rulesetName,rulesetName);assert.equal(methods.filter(x=>x==='POST').length,4);
 assert.ok(methods.slice(8).every(x=>x==='GET'));
});

test('a connection reset still requires exact-candidate recovery before acceptance',async()=>{
 let calls=0;
 const result=await validateUnboundProbe({...input,fetchImpl:async()=>{
  if(calls++===0)throw new TypeError('fetch failed',{cause:{code:'ECONNRESET'}});
  return response(200,{name:probeName,rulesetName});
 }});
 assert.equal(result.rulesetName,rulesetName);assert.equal(calls,2);
});
test('persistent transport failures exhaust bounded verification without certifying a control',async()=>{
 let calls=0;
 await assert.rejects(validateUnboundProbe({...input,fetchImpl:async()=>{calls++;throw new TypeError('fetch failed',{cause:{code:'ECONNRESET'}});}}),/exact probe not verified/);
 assert.equal(calls,12);
});
test('transport handling does not swallow programming errors or explicit rejection',async()=>{
 await assert.rejects(fetchRulesApi('test',{},async()=>{throw new Error('unexpected code defect');}),/code defect/);
 assert.equal((await fetchRulesApi('test',{},async()=>response(400,{error:{message:'oversized'}}))).status,400);
});


test('unavailable stored executable may recover through a separately verified byte-identical candidate',async()=>{
 const alternate='projects/test-project/rulesets/older-exact',calls:any[]=[];
 const result=await validateExactCandidateProbe({...input,rules:'exact input',log:()=>{},fetchImpl:async(url:any,options:any)=>{
  calls.push({url,options});
  if(url.endsWith('/rulesets?pageSize=32'))return response(200,{rulesets:[{name:rulesetName},{name:alternate}]});
  if(url.endsWith('/rulesets/older-exact'))return response(200,{name:alternate,source:{files:[{name:'firestore.rules',content:'exact input'}]}});
  if(options.method==='POST'){
   const data=JSON.parse(options.body);
   return data.rulesetName===alternate?response(200,data):response(503,{});
  }
  return response(404,{});
 }});
 assert.equal(result.rulesetName,alternate);
 assert.equal(result.probeName,'projects/test-project/releases/pharmhelm_size_probe_123_1001');
 assert.ok(calls.some(x=>x.options.method==='POST'&&JSON.parse(x.options.body).rulesetName===alternate));
 assert.ok(!calls.some(x=>x.url===`https://firebaserules.googleapis.com/v1/${rulesetName}`));
});
test('alternate recovery never retries an explicit size rejection, foreign response or authorization error',async()=>{
 for(const status of [400,403,200]){
  let calls=0;
  await assert.rejects(validateExactCandidateProbe({...input,rules:'exact',fetchImpl:async()=>{
   calls++;return response(status,status===200?{name:probeName,rulesetName:'projects/foreign/rulesets/x'}:{error:{message:'explicit rejection'}});
  }}),status===200?/Conflicting/:/explicit rejection/);
  assert.equal(calls,1);
 }
});
test('alternate recovery fails closed when only mismatched or malformed source copies exist',async()=>{
 let lookups=0;
 await assert.rejects(validateExactCandidateProbe({...input,rules:'exact',fetchImpl:async(url:any,options:any)=>{
  if(url.endsWith('/rulesets?pageSize=32'))return response(200,{rulesets:['different','extra-file','wrong-name','wrong-file','foreign'].map(name=>({name:`projects/test-project/rulesets/${name}`}))});
  if(url.includes('/rulesets/')){
   lookups++;const name=url.slice('https://firebaserules.googleapis.com/v1/'.length);
   return response(200,{name:name.endsWith('wrong-name')?'projects/foreign/rulesets/x':name,source:{files:name.endsWith('extra-file')?[{name:'firestore.rules',content:'exact'},{name:'extra',content:''}]:[{name:name.endsWith('wrong-file')?'other.rules':'firestore.rules',content:name.endsWith('different')||name.endsWith('foreign')?'not exact':'exact'}]}});
  }
  return response(options.method==='POST'?503:404,{});
 }}),/not verified/);
 assert.equal(lookups,5);
});
test('alternate recovery is bounded to three hosted candidates and never reuses a tried ruleset',async()=>{
 const posts:string[]=[];let lists=0;
 await assert.rejects(validateExactCandidateProbe({...input,rules:'exact',log:()=>{},fetchImpl:async(url:any,options:any)=>{
  if(url.endsWith('/rulesets?pageSize=32')){lists++;return response(200,{rulesets:[rulesetName,'projects/test-project/rulesets/b','projects/test-project/rulesets/c','projects/test-project/rulesets/d'].map(name=>({name}))});}
  if(url.includes('/rulesets/'))return response(200,{name:url.slice('https://firebaserules.googleapis.com/v1/'.length),source:{files:[{name:'firestore.rules',content:'exact'}]}});
  if(options.method==='POST'){posts.push(JSON.parse(options.body).rulesetName);return response(503,{});}
  return response(404,{});
 }}),/not verified/);
 assert.equal(lists,2);assert.equal(posts.length,12);assert.equal(new Set(posts).size,3);
});
