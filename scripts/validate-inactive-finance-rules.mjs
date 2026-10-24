/** Check activation-only limits using a temporary release with no backend binding.
 * Never targets cloud.firestore, firebase.storage or production document data.
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const token=process.env.GOOGLE_OAUTH_ACCESS_TOKEN || await new (await import('google-auth-library')).GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']}).getAccessToken();
if(!token)throw new Error('Scoped CI authentication is required.');
const project='gen-lang-client-0911422817',rules=readFileSync(process.argv[2]||'firestore.rules','utf8');
let result;
for(let attempt=1;attempt<=4;attempt++) {
 const response=await fetch(`https://firebaserules.googleapis.com/v1/projects/${project}/rulesets`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({source:{files:[{name:'firestore.rules',content:rules}]}}),signal:AbortSignal.timeout(60000)});
 result=await response.json();
 if(response.ok)break;
 if(![429,500,502,503,504].includes(response.status)||attempt===4) {
  if(response.status===503) {
   const control=await fetch(`https://firebaserules.googleapis.com/v1/projects/${project}/rulesets`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({source:{files:[{name:'firestore.rules',content:"rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }"}]}}),signal:AbortSignal.timeout(60000)});
   const payload=await control.json();
   console.log(JSON.stringify({mode:'MINIMAL_INACTIVE_RULESET_CONTROL',status:control.status,productionReleaseModified:false}));
   if(control.ok && payload.name?.startsWith(`projects/${project}/rulesets/`)) {
    const cleanup=await fetch(`https://firebaserules.googleapis.com/v1/${payload.name}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)});
    if(!cleanup.ok)throw new Error(`Minimal inactive control cleanup failed (${cleanup.status})`);
   }
   if(process.env.PHARMHELM_COMPILER_BASELINE_RULES) {
    const baseline=readFileSync(process.env.PHARMHELM_COMPILER_BASELINE_RULES,'utf8');
    const check=await fetch(`https://firebaserules.googleapis.com/v1/projects/${project}/rulesets`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({source:{files:[{name:'firestore.rules',content:baseline}]}}),signal:AbortSignal.timeout(60000)});
    const body=await check.json();
    console.log(JSON.stringify({mode:'CERTIFIED_INACTIVE_RULESET_CONTROL',status:check.status,sourceSHA256:createHash('sha256').update(baseline).digest('hex'),sourceBytes:Buffer.byteLength(baseline),productionReleaseModified:false,candidateCertified:false}));
    if(check.ok && body.name?.startsWith(`projects/${project}/rulesets/`)) {
     const cleanup=await fetch(`https://firebaserules.googleapis.com/v1/${body.name}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)});
     if(!cleanup.ok)throw new Error(`Certified inactive control cleanup failed (${cleanup.status})`);
    }
   }
  }
  throw new Error(`Inactive ruleset validation failed (${response.status}): ${result.error?.message||'Unknown compiler error'}`);
 }
 console.log(`Rules API transient HTTP ${response.status}; retry ${attempt}/4 without activating any release.`);
 await new Promise(resolve=>setTimeout(resolve,attempt*5000));
}
if(!result.name?.startsWith(`projects/${project}/rulesets/`))throw new Error('Unexpected inactive ruleset response.');
const probeName=`projects/${project}/releases/pharmhelm_size_probe_${process.env.GITHUB_RUN_ID||Date.now()}_${process.env.GITHUB_RUN_ATTEMPT||1}`;
if(!/^projects\/gen-lang-client-0911422817\/releases\/pharmhelm_size_probe_[0-9]+_[0-9]+$/.test(probeName))throw new Error('Unsafe validation release name.');
let release;
for (let attempt=1;attempt<=4;attempt++) {
 const response=await fetch(`https://firebaserules.googleapis.com/v1/projects/${project}/releases`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({name:probeName,rulesetName:result.name}),signal:AbortSignal.timeout(60000)});
 release=await response.json();
 if(response.ok)break;
 if (![409,429,500,502,503,504].includes(response.status))
   throw new Error(`Compiled executable activation-size validation failed (${response.status}): ${release.error?.message||'Unknown activation error'}`);
 // An unavailable response can follow a committed creation. Recover only this
 // exact unbound probe and exact candidate ruleset; never infer successful compilation.
 const recovery=await fetch(`https://firebaserules.googleapis.com/v1/${probeName}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)});
 if(recovery.ok) {
   release=await recovery.json();
   if(release.name!==probeName || release.rulesetName!==result.name)throw new Error('Conflicting size probe release');
   break;
 }
 if(attempt===4 || ![404,429,500,502,503,504].includes(recovery.status))
   throw new Error(`Compiled executable activation-size validation unavailable (${response.status}); probe recovery HTTP ${recovery.status}`);
 console.log(`Unbound release probe transient HTTP ${response.status}; retry ${attempt}/4. No production release modified.`);
 await new Promise(resolve=>setTimeout(resolve,attempt*5000));
}
try{
 if(release.name!==probeName||release.rulesetName!==result.name)throw new Error('Unexpected size-validation release.');
 console.log(JSON.stringify({mode:'UNBOUND_RELEASE_SIZE_VALIDATION',ruleset:result.name,sourceSHA256:createHash('sha256').update(rules).digest('hex'),sourceBytes:Buffer.byteLength(rules),productionReleaseModified:false}));
}finally{
 const cleanup=await fetch(`https://firebaserules.googleapis.com/v1/${probeName}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)});
 if(!cleanup.ok)throw new Error(`Temporary validation release cleanup failed (${cleanup.status}).`);
}

