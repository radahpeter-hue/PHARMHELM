/** Validate release-size limits by creating an INACTIVE ruleset only.
 * Never calls releases, never touches Firestore documents or production routing.
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const token=process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
if(!token)throw new Error('Scoped CI authentication is required.');
const project='gen-lang-client-0911422817',rules=readFileSync('firestore.rules','utf8');
const response=await fetch(`https://firebaserules.googleapis.com/v1/projects/${project}/rulesets`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({source:{files:[{name:'firestore.rules',content:rules}]}}),signal:AbortSignal.timeout(60000)});
const result=await response.json();
if(!response.ok)throw new Error(`Inactive ruleset validation failed (${response.status}): ${result.error?.message||'Unknown compiler error'}`);
if(!result.name?.startsWith(`projects/${project}/rulesets/`))throw new Error('Unexpected inactive ruleset response.');
console.log(JSON.stringify({mode:'INACTIVE_RULESET_VALIDATION',ruleset:result.name,sourceSHA256:createHash('sha256').update(rules).digest('hex'),sourceBytes:Buffer.byteLength(rules),productionReleaseModified:false}));
