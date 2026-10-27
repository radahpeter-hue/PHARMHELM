/** Non-secret diagnostics for the existing Rules API verification requests. */
export function createRulesDiagnosticFetch({fetchImpl=globalThis.fetch,log=console.log,sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms)),now=()=>Date.now()}={}) {
 return async(url,options={})=>{
  const method=options.method||'GET';
  for(let attempt=1;attempt<=3;attempt++){
   const started=now();
   // Each retry gets a fresh request deadline after quota backoff.
   const response=await fetchImpl(url,{...options,signal:AbortSignal.timeout(60000)});
   const headers={};
   for(const key of ['x-request-id','x-goog-request-id','x-cloud-trace-context','retry-after','server'])if(response.headers.get(key))headers[key]=response.headers.get(key);
   let error;
   if(!response.ok){try{const payload=await response.clone().json();error=payload.error;}catch{error={message:'Non-JSON response',body:(await response.clone().text()).slice(0,2000)};}}
   log(JSON.stringify({mode:'RULES_API_REQUEST',method,endpoint:new URL(url).pathname,status:response.status,elapsedMs:now()-started,headers,...(error?{error}:{} )}));
   // Creation keeps separate ambiguity/ownership handling. Only idempotent
   // reads and exact owned cleanup retry quota errors; no error certifies rules.
   if(response.status!==429||!['GET','DELETE'].includes(method)||attempt===3)return response;
   const retryAfter=response.headers.get('retry-after');
   const seconds=retryAfter!==null&&/^\d+(\.\d+)?$/.test(retryAfter)?Number(retryAfter)*1000:Date.parse(retryAfter||'')-now();
   const delayMs=Math.min(120000,Math.max(60000,Number.isFinite(seconds)?seconds:60000));
   log(JSON.stringify({mode:'RULES_API_QUOTA_BACKOFF',method,attempt,delayMs,productionReleaseModified:false}));
   await sleep(delayMs);
  }
 };
}
export async function readRulesetInventory({project,token,fetchImpl=globalThis.fetch,log=console.log,maxPages=1}) {
 if(!Number.isInteger(maxPages)||maxPages<1||maxPages>30)throw new Error("Invalid inventory request budget.");
 let count=0,pageToken='',pages=0;
 do{
  const url=new URL(`https://firebaserules.googleapis.com/v1/projects/${project}/rulesets`);
  url.searchParams.set('pageSize','100');if(pageToken)url.searchParams.set('pageToken',pageToken);
  const response=await fetchImpl(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)});
  if(!response.ok){log(JSON.stringify({mode:'READ_ONLY_RULESET_INVENTORY',status:response.status,complete:false,count}));return;}
  const result=await response.json();count+=(result.rulesets||[]).length;pageToken=result.nextPageToken||'';pages++;
 }while(pageToken&&pages<maxPages);
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
/** Recover exact immutable source; separately prove ownership before any cleanup. */
export async function recoverOwnedCandidate({project,token,rules,fileName,fileFingerprint=null,runOwnedFileName=false,allowSharedExactSource=false,startedAt,fetchImpl=globalThis.fetch,log=console.log}) {
 if(!Number.isFinite(startedAt))throw new Error('Invalid recovery start time.');
 const filter='createTime > date('+JSON.stringify(new Date(startedAt-60000).toISOString())+')';
 let pageToken='',pages=0;
 do {
  const url=new URL(`https://firebaserules.googleapis.com/v1/projects/${project}/rulesets`);url.searchParams.set('pageSize','100');url.searchParams.set('filter',filter);if(pageToken)url.searchParams.set('pageToken',pageToken);
  const response=await fetchImpl(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)});
  if(!response.ok)return null;
  const result=await response.json();
  for(const record of result.rulesets||[]) {
   if(!record.name?.startsWith(`projects/${project}/rulesets/`)||Date.parse(record.createTime)<startedAt-60000||!Number.isFinite(Date.parse(record.createTime)))continue;
   const detail=await fetchImpl(`https://firebaserules.googleapis.com/v1/${record.name}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)});
   if(!detail.ok)continue;
   const candidate=await detail.json(),files=candidate.source?.files;
   if(candidate.name===record.name&&files?.length===1&&files[0].name===fileName&&files[0].content===rules){
    const recoveryOwned=runOwnedFileName||!!fileFingerprint&&files[0].fingerprint===fileFingerprint;
    if(!recoveryOwned&&!allowSharedExactSource){log(JSON.stringify({mode:'EXACT_SOURCE_OWNERSHIP_UNPROVEN',fingerprintPresent:!!files[0].fingerprint,candidateCertified:false}));continue;}
    log(JSON.stringify({mode:recoveryOwned?'RECOVERED_EXACT_RUN_OWNED_CANDIDATE':'RECOVERED_SHARED_EXACT_SOURCE_READ_ONLY',ruleset:candidate.name,recoveryOwned,productionReleaseModified:false,candidateCertified:false}));
    return {...candidate,recoveryOwned};
   }
  }
  pageToken=result.nextPageToken||'';pages++;
 }while(pageToken&&pages<3);
 return null;
}
