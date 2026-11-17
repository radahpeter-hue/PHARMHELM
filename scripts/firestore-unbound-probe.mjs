/** Locate exact persisted input after an ambiguous ruleset-create response.
 * Persistence is never acceptance: the caller must still verify a release.
 */
export async function findExactInactiveRuleset({project,token,rules,fetchImpl=fetch}) {
 if(!/^[a-z0-9-]+$/.test(project))throw Error('Unsafe ruleset project.');
 const root=`https://firebaserules.googleapis.com/v1/projects/${project}/rulesets`,headers={Authorization:`Bearer ${token}`};
 const listed=await fetchImpl(root+'?pageSize=8',{headers,signal:AbortSignal.timeout(60000)});
 if(!listed.ok)return null;
 const {rulesets=[]}=await listed.json();
 for(const row of rulesets.slice(0,8)){
  if(!row.name?.startsWith(`projects/${project}/rulesets/`))continue;
  const response=await fetchImpl('https://firebaserules.googleapis.com/v1/'+row.name,{headers,signal:AbortSignal.timeout(60000)});
  if(!response.ok)continue;
  const saved=await response.json(),files=saved.source?.files;
  if(saved.name===row.name&&files?.length===1&&files[0].name==='firestore.rules'&&files[0].content===rules)return saved;
 }
 return null;
}

/** Verify the actual compiled limit without binding any production release.
 * Ambiguous errors count as success only after GET verifies this exact probe.
 */
export async function validateUnboundProbe({project,token,rulesetName,probeName,fetchImpl=fetch,pause=ms=>new Promise(r=>setTimeout(r,ms))}) {
 if(!/^projects\/[a-z0-9-]+\/releases\/pharmhelm_size_probe_[0-9]+_[0-9]+$/.test(probeName)||!probeName.startsWith(`projects/${project}/`)||!rulesetName.startsWith(`projects/${project}/rulesets/`))throw Error('Unsafe unbound probe identity.');
 const base='https://firebaserules.googleapis.com/v1/',headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
 const exact=data=>{if(data.name!==probeName||data.rulesetName!==rulesetName)throw Error('Conflicting unbound size probe.');return data;};
 for(let attempt=1;attempt<=4;attempt++){
  const response=await fetchImpl(`${base}projects/${project}/releases`,{method:'POST',headers,body:JSON.stringify({name:probeName,rulesetName}),signal:AbortSignal.timeout(60000)});
  const data=await response.json();
  if(response.ok)return exact(data);
  if(![409,429,500,502,503,504].includes(response.status))throw Error(`Compiled executable activation-size validation failed (${response.status}): ${data.error?.message||'Unknown activation error'}`);
  const recovery=await fetchImpl(base+probeName,{headers,signal:AbortSignal.timeout(60000)});
  if(recovery.ok)return exact(await recovery.json());
  if(![404,429,500,502,503,504].includes(recovery.status))throw Error(`Unbound probe verification failed (${recovery.status}).`);
  if(attempt===4)throw Error(`Compiled executable activation-size validation unavailable (${response.status}); exact probe not verified.`);
  console.log(`Unbound probe HTTP ${response.status}; retry ${attempt}/4. No production release modified.`);
  await pause(attempt*5000);
 }
 throw Error('Unbound probe was not verified.');
}
