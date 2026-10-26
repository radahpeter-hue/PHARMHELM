/** Non-secret diagnostics for the existing Rules API verification requests. */
export function createRulesDiagnosticFetch({fetchImpl=globalThis.fetch,log=console.log}={}) {
 return async(url,options={})=>{
  const started=Date.now();
  const response=await fetchImpl(url,options);
  const headers={};
  for(const key of ['x-request-id','x-goog-request-id','x-cloud-trace-context','retry-after','server'])if(response.headers.get(key))headers[key]=response.headers.get(key);
  let error;
  if(!response.ok){try{const payload=await response.clone().json();error=payload.error;}catch{error={message:'Non-JSON response',body:(await response.clone().text()).slice(0,2000)};}}
  log(JSON.stringify({mode:'RULES_API_REQUEST',method:options.method||'GET',endpoint:new URL(url).pathname,status:response.status,elapsedMs:Date.now()-started,headers,...(error?{error}:{} )}));
  return response;
 };
}
export async function readRulesetInventory({project,token,fetchImpl=globalThis.fetch,log=console.log}) {
 let count=0,pageToken='',pages=0;
 do{
  const url=new URL(`https://firebaserules.googleapis.com/v1/projects/${project}/rulesets`);
  url.searchParams.set('pageSize','100');if(pageToken)url.searchParams.set('pageToken',pageToken);
  const response=await fetchImpl(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)});
  if(!response.ok){log(JSON.stringify({mode:'READ_ONLY_RULESET_INVENTORY',status:response.status,complete:false,count}));return;}
  const result=await response.json();count+=(result.rulesets||[]).length;pageToken=result.nextPageToken||'';pages++;
 }while(pageToken&&pages<30);
 log(JSON.stringify({mode:'READ_ONLY_RULESET_INVENTORY',status:200,count,complete:!pageToken,pages,productionReleaseModified:false}));
}
export async function runInactiveCompilerControl({project,token,rules,mode,fetchImpl=globalThis.fetch,log=console.log}) {
 const response=await fetchImpl(`https://firebaserules.googleapis.com/v1/projects/${project}/rulesets`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({source:{files:[{name:'firestore.rules',content:rules}]}}),signal:AbortSignal.timeout(60000)});
 const payload=await response.json();
 log(JSON.stringify({mode,status:response.status,sourceBytes:Buffer.byteLength(rules),productionReleaseModified:false,candidateCertified:false}));
 if(response.ok){
  if(!payload.name?.startsWith(`projects/${project}/rulesets/`))throw new Error('Unexpected inactive control identity.');
  const cleanup=await fetchImpl(`https://firebaserules.googleapis.com/v1/${payload.name}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)});
  if(!cleanup.ok)throw new Error(`Inactive diagnostic control cleanup failed (${cleanup.status}).`);
 }
 return response.status;
}
/** Recover an ambiguous creation only through exact run-owned file identity and bytes. */
export async function recoverOwnedCandidate({project,token,rules,fileName,startedAt,fetchImpl=globalThis.fetch,log=console.log}) {
 let pageToken='',pages=0;
 do {
  const url=new URL(`https://firebaserules.googleapis.com/v1/projects/${project}/rulesets`);url.searchParams.set('pageSize','100');if(pageToken)url.searchParams.set('pageToken',pageToken);
  const response=await fetchImpl(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)});
  if(!response.ok)return null;
  const result=await response.json();
  for(const record of result.rulesets||[]) {
   if(!record.name?.startsWith(`projects/${project}/rulesets/`)||Date.parse(record.createTime)<startedAt-60000||!Number.isFinite(Date.parse(record.createTime)))continue;
   const detail=await fetchImpl(`https://firebaserules.googleapis.com/v1/${record.name}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)});
   if(!detail.ok)continue;
   const candidate=await detail.json(),files=candidate.source?.files;
   if(candidate.name===record.name&&files?.length===1&&files[0].name===fileName&&files[0].content===rules){
    log(JSON.stringify({mode:'RECOVERED_EXACT_RUN_OWNED_CANDIDATE',ruleset:candidate.name,productionReleaseModified:false,candidateCertified:false}));return candidate;
   }
  }
  pageToken=result.nextPageToken||'';pages++;
 }while(pageToken&&pages<30);
 return null;
}
