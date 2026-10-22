import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
function run(mode:string) {
 return spawnSync(process.execPath,['--input-type=module','-e',`
 process.env.GOOGLE_OAUTH_ACCESS_TOKEN='unit-test-sentinel';
 process.env.GITHUB_RUN_ID='123'; process.env.GITHUB_RUN_ATTEMPT='1';
 const project='projects/gen-lang-client-0911422817';
 const name=project+'/releases/pharmhelm_size_probe_123_1';
 const ruleset=project+'/rulesets/test-candidate';
 const calls=[];
 globalThis.fetch=async (url,options)=>{
   calls.push({url,method:options.method||'GET'});
   let status=200,body={};
   if(url.endsWith('/rulesets'))body={name:ruleset};
   else if(url.endsWith('/releases')) {status=${JSON.stringify(mode)}==='size-error'?400:503;body={error:{message:'fixture'}};}
   else if(url.endsWith('/pharmhelm_size_probe_123_1')) {
     if(options.method==='DELETE')body={};
     else body={name,rulesetName:${JSON.stringify(mode)}==='conflict'?ruleset+'-other':ruleset};
   } else throw new Error('Unexpected network request');
   return {ok:status===200,status,json:async()=>body};
 };
 await import('./scripts/validate-inactive-finance-rules.mjs');
 console.log(JSON.stringify(calls));
 `],{encoding:'utf8'});
}
test('size probe recovers an exact completed unbound release after HTTP 503 and cleans it',()=>{
 const result=run('recovery');
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/UNBOUND_RELEASE_SIZE_VALIDATION/);
 assert.match(result.stdout,/"productionReleaseModified":false/);
 const calls=JSON.parse(result.stdout.trim().split('\n').at(-1)!);
 assert.equal(calls.at(-1).method,'DELETE');
 assert.equal(calls.length,4);
});
test('size limit rejection remains a hard failure',()=>{
 const result=run('size-error');assert.notEqual(result.status,0);assert.match(result.stderr,/validation failed \(400\)/);
});
test('ambiguous probe can never certify a different ruleset',()=>{
 const result=run('conflict');assert.notEqual(result.status,0);assert.match(result.stderr,/Conflicting size probe/);
});
