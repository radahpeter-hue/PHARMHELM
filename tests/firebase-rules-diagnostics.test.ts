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
  const result=await recoverOwnedCandidate({project:'p',token:'PRIVATE',rules:'exact rules',fileName:'unique-run.rules',startedAt:Date.now(),log:()=>{},fetchImpl:async(url:URL|string)=>{
   if(String(url).includes('?'))return new Response(JSON.stringify({rulesets:[{name,createTime:variation==='old'?'2000-01-01T00:00:00Z':new Date().toISOString()}]}),{status:200});
   return new Response(JSON.stringify({name,source:{files:[{name:variation==='foreign-name'?'other-run.rules':'unique-run.rules',content:variation==='changed-source'?'changed':'exact rules'}]}}),{status:200});
  }});
  assert.equal(!!result,variation==='correct');
 }
});
test('inventory counts all pages using read-only requests and reports incomplete access honestly',async()=>{
 const calls:any[]=[];const logs:string[]=[];
 await readRulesetInventory({project:'p',token:'PRIVATE',log:(s:string)=>logs.push(s),fetchImpl:async(url:URL,options:any)=>{calls.push({url:String(url),method:options.method});return new Response(JSON.stringify(calls.length===1?{rulesets:[{},{}],nextPageToken:'page2'}:{rulesets:[{}]}),{status:200});}});
 assert.equal(JSON.parse(logs[0]).count,3);assert.equal(JSON.parse(logs[0]).complete,true);assert.equal(calls.length,2);assert.ok(calls.every(c=>c.method===undefined));
 assert.ok(calls.every(c=>new URL(c.url).searchParams.get('pageSize')==='100'));
 const denied:string[]=[];await readRulesetInventory({project:'p',token:'PRIVATE',log:(s:string)=>denied.push(s),fetchImpl:async()=>new Response('{}',{status:403})});
 assert.equal(JSON.parse(denied[0]).complete,false);assert.equal(JSON.parse(denied[0]).status,403);
});
