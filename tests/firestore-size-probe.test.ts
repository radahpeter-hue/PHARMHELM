import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
function run(mode:string) {
 return spawnSync(process.execPath,['--input-type=module','-e',`
 process.env.GOOGLE_OAUTH_ACCESS_TOKEN='unit-test-sentinel';
 process.env.GITHUB_RUN_ID='123'; process.env.GITHUB_RUN_ATTEMPT='1';
 if(${JSON.stringify(mode)}==='baseline-error')process.env.PHARMHELM_COMPILER_BASELINE_RULES='firestore.rules';
 const project='projects/gen-lang-client-0911422817';
 const name=project+'/releases/pharmhelm_size_probe_123_1';
 const ruleset=project+'/rulesets/test-candidate';
 const calls=[];
 let probeDeleted=false,createdSource,probeReads=0;
 globalThis.setTimeout=(callback)=>{queueMicrotask(callback);return 0;};
 globalThis.fetch=async (url,options)=>{
   url=String(url);
   calls.push({url,method:options.method||'GET'});
   let status=200,body={};
   if(url.includes('/rulesets?'))body={rulesets:${JSON.stringify(mode)}==='create-ambiguous'?[{name:ruleset,createTime:new Date().toISOString()}]:[]};
   else if(url.endsWith('/rulesets')){createdSource=JSON.parse(options.body).source;body={name:ruleset};if(['service-error','baseline-error','create-ambiguous'].includes(${JSON.stringify(mode)})){
     status=${JSON.stringify(mode)}==='baseline-error'&&calls.filter(c=>c.url.endsWith('/rulesets')&&c.method==='POST').length>4?200:503;
     body=status===200?{name:ruleset}:{error:{message:'fixture unavailable'}};
   }}
   else if(url.endsWith('/rulesets/test-candidate')&&options.method==='DELETE')body={};
   else if(url.endsWith('/rulesets/test-candidate'))body={name:ruleset,source:createdSource};
   else if(url.endsWith('/releases')) {status=${JSON.stringify(mode)}==='size-error'?400:503;body={error:{message:'fixture'}};}
   else if(url.endsWith('/pharmhelm_size_probe_123_1')) {
     if(options.method==='DELETE'){body={};probeDeleted=true;}
     else if(probeDeleted||${JSON.stringify(mode)}==='size-error'||${JSON.stringify(mode)}==='probe-absent'||(['delayed-release','delayed-conflict'].includes(${JSON.stringify(mode)})&&++probeReads<=4)){status=404;body={error:{message:'not found'}};}
     else body={name,rulesetName:['conflict','delayed-conflict'].includes(${JSON.stringify(mode)})?ruleset+'-other':ruleset};
   } else throw new Error('Unexpected network request');
   return new Response(JSON.stringify(body),{status});
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
 assert.equal(calls.length,6);
 assert.ok(calls.at(-1).url.endsWith('/rulesets/test-candidate'));
});
test('size limit rejection remains a hard failure',()=>{
 const result=run('size-error');assert.notEqual(result.status,0);assert.match(result.stderr,/validation failed \(400\)/);
});
test('ambiguous creation is recovered by exact run-owned source before the real release size check',()=>{
 const result=run('create-ambiguous');assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/RECOVERED_EXACT_RUN_OWNED_CANDIDATE/);
 assert.match(result.stdout,/UNBOUND_RELEASE_SIZE_VALIDATION/);
 assert.match(result.stdout,/OWNED_CANDIDATE_CLEANUP/);
});
test('ambiguous probe can never certify a different ruleset',()=>{
 const result=run('conflict');assert.notEqual(result.status,0);assert.match(result.stderr,/Conflicting size probe/);
 assert.match(result.stdout,/OWNED_CANDIDATE_CLEANUP_DEFERRED/);
});

test('persistent rules API failure runs an inactive minimal control and never certifies the candidate',()=>{
 const result=run('service-error');
 assert.notEqual(result.status,0);
 assert.match(result.stdout,/MINIMAL_INACTIVE_RULESET_CONTROL/);
 assert.match(result.stdout,/"status":503/);
 assert.match(result.stderr,/Inactive ruleset validation failed \(503\)/);
 assert.doesNotMatch(result.stdout,/UNBOUND_RELEASE_SIZE_VALIDATION/);
});
test('a successful certified baseline control cannot certify the failing new candidate',()=>{
 const result=run('baseline-error');assert.notEqual(result.status,0);
 assert.match(result.stdout,/CERTIFIED_INACTIVE_RULESET_CONTROL/);
 assert.match(result.stdout,/"status":200/);
 assert.match(result.stdout,/"candidateCertified":false/);
 assert.doesNotMatch(result.stdout,/UNBOUND_RELEASE_SIZE_VALIDATION/);
});

test('late server completion still requires the real exact unbound release before certification',()=>{
 const result=run('delayed-release');assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/RECOVERED_EXACT_LATE_UNBOUND_RELEASE/);assert.match(result.stdout,/UNBOUND_RELEASE_SIZE_VALIDATION/);assert.match(result.stdout,/OWNED_CANDIDATE_CLEANUP/);
});
test('late recovery cannot accept a conflicting ruleset',()=>{
 const result=run('delayed-conflict');assert.notEqual(result.status,0);assert.match(result.stderr,/Conflicting late size probe release/);assert.doesNotMatch(result.stdout,/UNBOUND_RELEASE_SIZE_VALIDATION/);
});
test('an absent probe after the bounded grace period never receives a size certificate',()=>{
 const result=run('probe-absent');assert.notEqual(result.status,0);assert.match(result.stderr,/probe recovery HTTP 404/);assert.doesNotMatch(result.stdout,/UNBOUND_RELEASE_SIZE_VALIDATION/);
});
