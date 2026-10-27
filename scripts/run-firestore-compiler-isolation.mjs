/** Collect observations only. A subset passing never certifies production rules. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const directory=process.argv[2],verifier=process.argv[3];
if(!directory||!verifier)throw new Error('Explicit control directory and existing verifier required');
const manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8'));
if(manifest.diagnosticOnly!==true||manifest.productionCandidate!==false)throw new Error('Not an isolation manifest');
const operation=process.env.GITHUB_RUN_ID;
if(!/^[0-9]+$/.test(operation||''))throw new Error('Numeric CI operation required');
const evidence={diagnosticOnly:true,productionCandidateCertified:false,commit:process.env.ISOLATION_COMMIT,observations:[]};
const ordered=[...manifest.cases].sort((a,b)=>(a.name==='all-denied'?-1:0)-(b.name==='all-denied'?-1:0));
for(const [index,c] of ordered.entries()){
 if(!/^[a-z-]+$/.test(c.name))throw new Error('Invalid case name');
 const file=join(directory,c.name+'.rules'),source=readFileSync(file,'utf8'),started=Date.now();
 const env={...process.env,GITHUB_RUN_ID:operation+String(20+index)};
 // Do not inherit unrelated multi-stage controls; the unchanged verifier still
 // performs actual unbound-release validation for this exact diagnostic input.
 for(const name of Object.keys(env))if(name.startsWith('PHARMHELM_COMPILER_'))delete env[name];
 const result=spawnSync(process.execPath,[verifier,file],{env,encoding:'utf8',maxBuffer:16*1024*1024});
 const log=(result.stdout||'')+'\n'+(result.stderr||'');
 writeFileSync(join(directory,c.name+'.log'),log);
 const actual=result.status===0&&log.includes('"mode":"UNBOUND_RELEASE_SIZE_VALIDATION"');
 const entry={...c,sourceSHA256:createHash('sha256').update(source).digest('hex'),sourceBytes:Buffer.byteLength(source),elapsedMs:Date.now()-started,exitCode:result.status,actualDiagnosticReleasePassed:actual,errors:log.split('\n').filter(x=>x.startsWith('Error:')).slice(-3),log:c.name+'.log'};
 evidence.observations.push(entry);writeFileSync(join(directory,'observations.json'),JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify(entry));
 if(result.error||result.signal)throw new Error('Isolation process did not complete: '+String(result.error||result.signal));
}
// Workflow success means observations collected, not financial acceptance.
console.log('DIAGNOSTIC_COMPLETE: no production candidate certified.');
