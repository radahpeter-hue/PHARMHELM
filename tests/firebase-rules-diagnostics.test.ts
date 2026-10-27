import test from 'node:test';
import assert from 'node:assert/strict';
import {ValidationStatus,classifyRulesValidationOutcome,computeRetryDelayMs,createRulesDiagnosticFetch,deleteRulesResourceWithRetry,parseExecutableSizeError,readRulesetInventory,recoverOwnedCandidate} from '../scripts/firebase-rules-diagnostics.mjs';
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
test('inventory counts all pages using read-only requests and reports incomplete access honestly',async()=>{
 const calls:any[]=[];const logs:string[]=[];
 await readRulesetInventory({project:'p',token:'PRIVATE',log:(s:string)=>logs.push(s),fetchImpl:async(url:URL,options:any)=>{calls.push({url:String(url),method:options.method});return new Response(JSON.stringify(calls.length===1?{rulesets:[{},{}],nextPageToken:'page2'}:{rulesets:[{}]}),{status:200});}});
 assert.equal(JSON.parse(logs[0]).count,3);assert.equal(JSON.parse(logs[0]).complete,true);assert.equal(calls.length,2);assert.ok(calls.every(c=>c.method===undefined));
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


test('parseExecutableSizeError extracts compiled executable byte count and limit from HTTP 400 size errors', () => {
  const parsed = parseExecutableSizeError(
    'Compiled executable ruleset size 261,840 bytes exceeds maximum allowed size of 256,000 bytes.',
  );
  assert.equal(parsed.isSizeError, true);
  assert.equal(parsed.executableBytes, 261840);
  assert.equal(parsed.limitBytes, 256000);

  const syntaxErr = parseExecutableSizeError('Unexpected identifier on line 42');
  assert.equal(syntaxErr.isSizeError, false);
  assert.equal(syntaxErr.executableBytes, null);
});

test('classifyRulesValidationOutcome distinguishes PASS, FAIL_SIZE, FAIL_RULES, FAIL_CANDIDATE_COMPLEXITY and BLOCKED_FIREBASE_SERVICE', () => {
  assert.equal(classifyRulesValidationOutcome({ candidateHttpStatus: 200 }).status, ValidationStatus.PASS);

  const sizeFail = classifyRulesValidationOutcome({
    candidateHttpStatus: 400,
    errorMessage: 'Executable size 260512 bytes exceeds limit 256000 bytes',
  });
  assert.equal(sizeFail.status, ValidationStatus.FAIL_SIZE);
  assert.equal(sizeFail.executableBytes, 260512);
  assert.equal(sizeFail.candidateCertified, false);

  const ruleFail = classifyRulesValidationOutcome({
    candidateHttpStatus: 400,
    errorMessage: 'Undefined function unknownHelper()',
  });
  assert.equal(ruleFail.status, ValidationStatus.FAIL_RULES);
  assert.equal(ruleFail.candidateCertified, false);

  const complexityFail = classifyRulesValidationOutcome({
    candidateHttpStatus: 503,
    minimalControlStatus: 200,
    phase5ControlStatus: 200,
  });
  assert.equal(complexityFail.status, ValidationStatus.FAIL_CANDIDATE_COMPLEXITY);
  assert.equal(complexityFail.diagnosticClass, 'CANDIDATE_SPECIFIC_COMPILER_FAILURE_PHASE5_PASSED');

  const largeRulesBlocked = classifyRulesValidationOutcome({
    candidateHttpStatus: 503,
    minimalControlStatus: 200,
    phase5ControlStatus: 503,
  });
  assert.equal(largeRulesBlocked.status, ValidationStatus.BLOCKED_FIREBASE_SERVICE);
  assert.equal(largeRulesBlocked.diagnosticClass, 'LARGE_RULES_COMPILER_OR_RELEASE_WORKER_DEGRADATION');

  const broadOutage = classifyRulesValidationOutcome({
    candidateHttpStatus: 503,
    minimalControlStatus: 503,
    phase5ControlStatus: 503,
  });
  assert.equal(broadOutage.status, ValidationStatus.BLOCKED_FIREBASE_SERVICE);
  assert.equal(broadOutage.diagnosticClass, 'BROAD_FIREBASE_SERVICE_OUTAGE');
});

test('deleteRulesResourceWithRetry retries transient 503 responses with bounded backoff and fails closed on exhaustion', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((cb: () => void) => {
    queueMicrotask(cb);
    return 0 as any;
  }) as any;
  try {
    let attempts = 0;
    const logs: string[] = [];
    const recovered = await deleteRulesResourceWithRetry({
      url: 'https://firebaserules.googleapis.com/v1/projects/p/releases/pharmhelm_size_probe_1_1',
      token: 'PRIVATE',
      label: 'Probe cleanup',
      maxAttempts: 4,
      log: (s: string) => logs.push(s),
      randomImpl: () => 0.5,
      fetchImpl: async () => {
        attempts++;
        return new Response('{}', { status: attempts < 3 ? 503 : 200 });
      },
    });
    assert.equal(recovered.ok, true);
    assert.equal(attempts, 3);
    assert.equal(logs.length, 2);
    assert.equal(JSON.parse(logs[0]).mode, 'CLEANUP_DELETE_RETRY');

    let exhaustedAttempts = 0;
    await assert.rejects(
      deleteRulesResourceWithRetry({
        url: 'https://firebaserules.googleapis.com/v1/projects/p/rulesets/owned',
        token: 'PRIVATE',
        label: 'Candidate cleanup',
        maxAttempts: 3,
        log: () => {},
        randomImpl: () => 0.5,
        fetchImpl: async () => {
          exhaustedAttempts++;
          return new Response('{}', { status: 503 });
        },
      }),
      /Candidate cleanup failed \(503\)/,
    );
    assert.equal(exhaustedAttempts, 3);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('computeRetryDelayMs applies bounded exponential backoff with jitter', () => {
  assert.equal(computeRetryDelayMs(1, { baseMs: 5000, maxMs: 45000, jitterRatio: 0.2, randomImpl: () => 0.5 }), 5000);
  assert.equal(computeRetryDelayMs(2, { baseMs: 5000, maxMs: 45000, jitterRatio: 0.2, randomImpl: () => 1 }), 12000);
  assert.equal(computeRetryDelayMs(6, { baseMs: 5000, maxMs: 45000, jitterRatio: 0.2, randomImpl: () => 0.5 }), 45000);
});
