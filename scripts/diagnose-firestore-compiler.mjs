// Diagnostic only. Never targets a backend-bound release or changes document data.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {findExactInactiveRuleset} from './firestore-unbound-probe.mjs';

export async function diagnoseCompiler({project,token,controls,runId,attachmentPoint=undefined,recoverPersisted=false,fetchImpl=fetch,log=console.log}) {
 if(!/^[a-z0-9-]+$/.test(project)||!/^\d+$/.test(String(runId)))throw Error('Unsafe diagnostic identity.');
 const root=`https://firebaserules.googleapis.com/v1/projects/${project}`;
 const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
 const results=[];
 for(const [index,control] of controls.entries()) {
  const result={label:control.label};
  let rulesetName,probeName;
  try {
   const source={files:[{name:'firestore.rules',content:control.source}]};
   const compiled=await fetchImpl(root+'/rulesets',{method:'POST',headers,body:JSON.stringify({source,...(attachmentPoint?{attachment_point:attachmentPoint}:{})}),signal:AbortSignal.timeout(60000)});
   result.compilerStatus=compiled.status;
   let body=await compiled.json();
   if(!compiled.ok&&recoverPersisted&&[500,502,503,504].includes(compiled.status)){
    const recovered=await findExactInactiveRuleset({project,token,rules:control.source,fetchImpl}).catch(()=>null);
    if(recovered){body=recovered;result.exactSourceRecovered=true;}
   }
   if(!compiled.ok&&!result.exactSourceRecovered){result.error=body.error?.message;continue;}
   if(!body.name?.startsWith(`projects/${project}/rulesets/`))throw Error('Unexpected diagnostic ruleset.');
   rulesetName=body.name;
   probeName=`projects/${project}/releases/pharmhelm_size_probe_${runId}_${index+100}`;
   const activated=await fetchImpl(root+'/releases',{method:'POST',headers,body:JSON.stringify({name:probeName,rulesetName}),signal:AbortSignal.timeout(60000)});
   result.releaseStatus=activated.status;
   if(!activated.ok)result.releaseError=(await activated.json()).error?.message;
   // Always inspect the exact release, including after an ambiguous POST failure.
   const verified=await fetchImpl('https://firebaserules.googleapis.com/v1/'+probeName,{headers,signal:AbortSignal.timeout(60000)});
   result.verificationStatus=verified.status;
   if(verified.ok){
    const data=await verified.json();
    if(data.name!==probeName||data.rulesetName!==rulesetName)throw Error('Conflicting diagnostic probe.');
    result.exactProbeVerified=true;
   }
  } catch(error){result.error=error.message;}
  finally {
   // DELETE is restricted to the unique diagnostic identities created above.
   for(const name of [probeName,...(result.exactSourceRecovered?[]:[rulesetName])].filter(Boolean)){
    try {
     const cleaned=await fetchImpl('https://firebaserules.googleapis.com/v1/'+name,{method:'DELETE',headers,signal:AbortSignal.timeout(60000)});
     if(!cleaned.ok&&cleaned.status!==404)result.cleanupError=`${name}: HTTP ${cleaned.status}`;
    }catch(error){result.cleanupError=error.message;}
   }
   results.push(result);log(JSON.stringify(result));
  }
 }
 return results;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const {GoogleAuth}=await import('google-auth-library');
 const token=await new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']}).getAccessToken();
 if(!token)throw Error('Scoped CI authentication is required.');
 const activeControls=[];
 try {
  const root='https://firebaserules.googleapis.com/v1/';
  const headers={Authorization:`Bearer ${token}`};
  const release=await fetch(root+'projects/gen-lang-client-0911422817/releases/cloud.firestore/ai-studio-f7d8654b-e089-425a-a506-38159afe1e75',{headers,signal:AbortSignal.timeout(60000)});
  if(!release.ok)throw Error(`Active release read: HTTP ${release.status}`);
  const {rulesetName}=await release.json();
  if(!rulesetName?.startsWith('projects/gen-lang-client-0911422817/rulesets/'))throw Error('Unexpected active ruleset identity.');
  const saved=await fetch(root+rulesetName,{headers,signal:AbortSignal.timeout(60000)});
  if(!saved.ok)throw Error(`Active source read: HTTP ${saved.status}`);
  const data=await saved.json(),file=data.source?.files?.find(file=>file.name==='firestore.rules');
  if(!file)throw Error('Active Firestore source unavailable.');
  activeControls.push({label:'Exact currently deployed source control',source:file.content});
 }catch(error){console.log(JSON.stringify({label:'Active source control unavailable',error:error.message}));}
 await diagnoseCompiler({project:'gen-lang-client-0911422817',token,recoverPersisted:true,attachmentPoint:'firestore.googleapis.com/projects/161921807585/databases/ai-studio-f7d8654b-e089-425a-a506-38159afe1e75',runId:process.env.GITHUB_RUN_ID||Date.now(),controls:[
  {label:'Minimal deny-all control',source:"rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }"},
  {label:'Current PR base control',source:readFileSync(process.argv[2],'utf8')},
  ...activeControls,
  ...process.argv.slice(3).map(path=>({label:path,source:readFileSync(path,'utf8')})),
 ]});
 console.log('Diagnostic controls do not certify the candidate. The original candidate failure remains blocking.');
}
