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
  url.searchParams.set('pageSize','1000');if(pageToken)url.searchParams.set('pageToken',pageToken);
  const response=await fetchImpl(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)});
  if(!response.ok){log(JSON.stringify({mode:'READ_ONLY_RULESET_INVENTORY',status:response.status,complete:false,count}));return;}
  const result=await response.json();count+=(result.rulesets||[]).length;pageToken=result.nextPageToken||'';pages++;
 }while(pageToken&&pages<20);
 log(JSON.stringify({mode:'READ_ONLY_RULESET_INVENTORY',status:200,count,complete:!pageToken,pages,productionReleaseModified:false}));
}
