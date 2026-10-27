import test from 'node:test';
import assert from 'node:assert/strict';
import {createRulesDiagnosticFetch,readRulesetInventory,recoverOwnedCandidate} from '../scripts/firebase-rules-diagnostics.mjs';
test('diagnostics retain API failure details without logging request credentials',async()=>{
 const logs:string[]=[];
 const fetch=createRulesDiagnosticFetch({log:(s:string)=>logs.push(s),fetchImpl:async()=>new Response(JSON.stringify({error:{code:503,status:'UNAVAILABLE',message:'compiler unavailable',details:[{reason:'BACKEND_ERROR'}]}}),{status:503,headers:{'x-request-id':'trace-123'}})});
 const response=await fetch('https://firebaserules.googleapis.com/v1/projects/p/rulesets',{method:'POST',headers:{Authorization:'Bearer PRIVATE_CREDENTIAL'},body:'PRIVATE_SOURCE'});
 assert.equal(response.status,503);assert.equal((await response.json()).error.code,503);
 const entry=JSON.parse(logs[0]);assert.equal(entry.headers['x-request-id'],'trace-123');assert.equal(entry.error.details[0].reason,'BACKEND_ERROR');
 assert.ok(!logs.join('').includes('PRIVATE_'));assert.ok(!logs.join('').includes('Authorization'));
});
test('candidate recovery rejects another operation, changed bytes and old metadata',async()=>{
 const name='projects/p/rulesets/owned';
 for(const variation of ['correct','foreign-name','changed-source','old']){
  const result=await recoverOwnedCandidate({project:'p',token:'PRIVATE',rules:'exact rules',fileName:'unique-run.rules',runOwnedFileName:true,startedAt:Date.now(),log:()=>{},fetchImpl:async(url:URL|string)=>{
   if(String(url).includes('?'))return new Response(JSON.stringify({rulesets:[{name,createTime:variation==='old'?'2000-01-01T00:00:00Z':new Date().toISOString()}]}),{status:200});
   return new Response(JSON.stringify({name,source:{files:[{name:variation==='foreign-name'?'other-run.rules':'unique-run.rules',content:variation==='changed-source'?'changed':'exact rules'}]}}),{status:200});
  }});
  assert.equal(!!result,variation==='correct');
 }
});
test('inventory respects its default request budget and reports partial access honestly',async()=>{
 const calls:any[]=[];const logs:string[]=[];
 await readRulesetInventory({project:'p',token:'PRIVATE',log:(s:string)=>logs.push(s),fetchImpl:async(url:URL,options:any)=>{calls.push({url:String(url),method:options.method});return new Response(JSON.stringify(calls.length===1?{rulesets:[{},{}],nextPageToken:'page2'}:{rulesets:[{}]}),{status:200});}});
 assert.equal(JSON.parse(logs[0]).count,2);assert.equal(JSON.parse(logs[0]).complete,false);assert.equal(calls.length,1);assert.ok(calls.every(c=>c.method===undefined));
 assert.ok(calls.every(c=>new URL(c.url).searchParams.get('pageSize')==='100'));
 const denied:string[]=[];await readRulesetInventory({project:'p',token:'PRIVATE',log:(s:string)=>denied.push(s),fetchImpl:async()=>new Response('{}',{status:403})});
 assert.equal(JSON.parse(denied[0]).complete,false);assert.equal(JSON.parse(denied[0]).status,403);
});


test('canonical filename recovery requires the exact run fingerprint as well as exact source',async()=>{
 for(const fingerprint of ['owned','other',undefined]){
  const name='projects/p/rulesets/canonical';
  const result=await recoverOwnedCandidate({project:'p',token:'PRIVATE',rules:'exact rules',fileName:'firestore.rules',fileFingerprint:'owned',startedAt:Date.now(),log:()=>{},fetchImpl:async(url:URL|string)=>new Response(JSON.stringify(String(url).includes('?')?{rulesets:[{name,createTime:new Date().toISOString()}]}:{name,source:{files:[{name:'firestore.rules',content:'exact rules',fingerprint}]}}),{status:200})});
  assert.equal(!!result,fingerprint==='owned');
 }
});

test('quota backoff retries an exact owned cleanup and honors bounded Retry-After',async()=>{
 const calls:any[]=[],delays:number[]=[];
 const fetch=createRulesDiagnosticFetch({log:()=>{},sleep:async(ms:number)=>{delays.push(ms);},fetchImpl:async(url:any,options:any)=>{
  calls.push([url,options]);return new Response('{}',{status:calls.length===1?429:200,headers:{'retry-after':'90'}});
 }});
 const url='https://firebaserules.googleapis.com/v1/projects/p/rulesets/owned';
 const options={method:'DELETE'};const response=await fetch(url,options);
 assert.equal(response.status,200);assert.deepEqual(delays,[90000]);
 assert.equal(calls.length,2);assert.ok(calls.every(c=>c[0]===url&&c[1].method===options.method));
 assert.notEqual(calls[0][1].signal,calls[1][1].signal);assert.equal(calls[1][1].signal.aborted,false);
});
test('persistent quota exhaustion remains failure after bounded retries; creation is never replayed here',async()=>{
 for(const method of ['GET','DELETE','POST']){
  let calls=0;const delays:number[]=[];
  const fetch=createRulesDiagnosticFetch({log:()=>{},sleep:async(ms:number)=>{delays.push(ms);},fetchImpl:async()=>{calls++;return new Response('{}',{status:429,headers:{'retry-after':'9999'}});}});
  assert.equal((await fetch('https://firebaserules.googleapis.com/v1/projects/p/rulesets',{method})).status,429);
  assert.equal(calls,method==='POST'?1:3);assert.deepEqual(delays,method==='POST'?[]:[120000,120000]);
 }
});
test('bounded recovery rejects old metadata without unsupported API filters',async()=>{
 const startedAt=Date.now(),urls:string[]=[];
 const result=await recoverOwnedCandidate({project:'p',token:'PRIVATE',rules:'exact',fileName:'firestore.rules',startedAt,log:()=>{},fetchImpl:async(url:any)=>{
  urls.push(String(url));return new Response(JSON.stringify({rulesets:[{name:'projects/p/rulesets/old',createTime:'2000-01-01T00:00:00Z'}],nextPageToken:'more'}),{status:200});
 }});
 assert.equal(result,null);assert.equal(urls.length,3);
 for(const url of urls)assert.equal(new URL(url).searchParams.has('filter'),false);
});
