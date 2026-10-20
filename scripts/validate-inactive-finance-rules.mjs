/** Validate release-size limits by creating an INACTIVE ruleset only.
 * Never calls releases, never touches Firestore documents or production routing.
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {GoogleAuth}=await import('google-auth-library');
const token=process.env.GOOGLE_OAUTH_ACCESS_TOKEN || await new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']}).getAccessToken();
if(!token)throw new Error('Scoped CI authentication is required.');
const project='gen-lang-client-0911422817',rules=readFileSync('firestore.rules','utf8');
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
console.log(JSON.stringify({mode:'INACTIVE_RULESET_VALIDATION',ruleset:result.name,sourceSHA256:createHash('sha256').update(rules).digest('hex'),sourceBytes:Buffer.byteLength(rules),productionReleaseModified:false}));
