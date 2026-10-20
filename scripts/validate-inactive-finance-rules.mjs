/** Check activation-only limits using a temporary release with no backend binding.
 * Never targets cloud.firestore, firebase.storage or production document data.
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {GoogleAuth}=await import('google-auth-library');
const token=process.env.GOOGLE_OAUTH_ACCESS_TOKEN || await new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']}).getAccessToken();
if(!token)throw new Error('Scoped CI authentication is required.');
const project='gen-lang-client-0911422817',rules=readFileSync(process.argv[2]||'firestore.rules','utf8');
let result;
for(let attempt=1;attempt<=4;attempt++) {
 const response=await fetch(`https://firebaserules.googleapis.com/v1/projects/${project}/rulesets`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({source:{files:[{name:'firestore.rules',content:rules}]}}),signal:AbortSignal.timeout(60000)});
 result=await response.json();
 if(response.ok)break;
 if(![429,500,502,503,504].includes(response.status)||attempt===4)throw new Error(`Inactive ruleset validation failed (${response.status}): ${result.error?.message||'Unknown compiler error'}`);
 console.log(`Rules API transient HTTP ${response.status}; retry ${attempt}/4 without activating any release.`);
 await new Promise(resolve=>setTimeout(resolve,attempt*5000));
}
if(!result.name?.startsWith(`projects/${project}/rulesets/`))throw new Error('Unexpected inactive ruleset response.');
const probeName=`projects/${project}/releases/pharmhelm_size_probe_${process.env.GITHUB_RUN_ID||Date.now()}_${process.env.GITHUB_RUN_ATTEMPT||1}`;
if(!/^projects\/gen-lang-client-0911422817\/releases\/pharmhelm_size_probe_[0-9]+_[0-9]+$/.test(probeName))throw new Error('Unsafe validation release name.');
// Validate with a temporary unbound release. A 503 may occur even after the
// API accepts the request, so inspect the exact release before retrying.
const probeUrl=`https://firebaserules.googleapis.com/v1/${probeName}`;
const transient=new Set([429,500,502,503,504]);
const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
let release;
for(let attempt=1;attempt<=5;attempt++){
 const response=await fetch(`https://firebaserules.googleapis.com/v1/projects/${project}/releases`,{
  method:'POST',headers,body:JSON.stringify({name:probeName,rulesetName:result.name}),signal:AbortSignal.timeout(60000)
 });
 const body=await response.json().catch(()=>({}));
 if(response.ok){release=body;break;}
 if(response.status===409||transient.has(response.status)){
  const check=await fetch(probeUrl,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)});
  if(check.ok){
   const existing=await check.json();
   if(existing.name!==probeName||existing.rulesetName!==result.name)throw new Error('Temporary size probe conflicts with another ruleset.');
   release=existing;break;
  }
  if(!transient.has(response.status)&&check.status!==404)throw new Error(`Temporary release lookup failed (${check.status}).`);
  if(attempt===5)throw new Error(`Compiled executable activation-size validation failed (${response.status}) after retries: ${body.error?.message||'Unavailable'}`);
  console.log(`Transient activation API HTTP ${response.status}; retry ${attempt}/5. No production release is modified.`);
  await new Promise(resolve=>setTimeout(resolve,Math.min(attempt*8000,30000)));
  continue;
 }
 throw new Error(`Compiled executable activation-size validation failed (${response.status}): ${body.error?.message||'Unknown activation error'}`);
}
if(!release)throw new Error('No validated temporary release returned.');
try{
 if(release.name!==probeName||release.rulesetName!==result.name)throw new Error('Unexpected size-validation release.');
 console.log(JSON.stringify({mode:'UNBOUND_RELEASE_SIZE_VALIDATION',ruleset:result.name,sourceSHA256:createHash('sha256').update(rules).digest('hex'),sourceBytes:Buffer.byteLength(rules),productionReleaseModified:false}));
}finally{
 const cleanup=await fetch(`https://firebaserules.googleapis.com/v1/${probeName}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)});
 if(!cleanup.ok)throw new Error(`Temporary validation release cleanup failed (${cleanup.status}).`);
}

