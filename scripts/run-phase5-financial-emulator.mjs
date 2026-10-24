// Development-only authenticated tests. Uses the same checksummed Java 17-compatible
// emulator as POS Spark tests; it has no production credentials or database binding.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import net from 'node:net';
const jar=process.env.FIRESTORE_EMULATOR_JAR||join(tmpdir(),'pharmhelm-firestore-emulator-v1.19.8.jar');
if(createHash('sha256').update(readFileSync(jar)).digest('hex')!=='9d43599ed6151199e8d604dc87fac51218e49e5f3a48519b1ae560bbe5e3382d')throw new Error('Firestore emulator checksum mismatch.');
const port=Number(process.env.PHASE5_EMULATOR_PORT||8089);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid local emulator port.');
const log=createWriteStream(join(tmpdir(),'phase5-financial-emulator.log'));
const emulator=spawn('java',['-jar',jar,'--host','127.0.0.1','--port',String(port),'--project_id','phase5-advance-rules']);
emulator.stdout.pipe(log);emulator.stderr.pipe(log);
let launchError;emulator.on('error',e=>{launchError=e;});
const connected=()=>new Promise(resolve=>{const socket=net.createConnection({host:'127.0.0.1',port});socket.on('connect',()=>{socket.destroy();resolve(true);});socket.on('error',()=>{socket.destroy();resolve(false);});});
try{
 let ready=false;
 for(let n=0;n<150;n++){if(launchError)throw launchError;if(emulator.exitCode!==null)throw new Error('Emulator exited during startup.');if(await connected()){ready=true;break;}await new Promise(r=>setTimeout(r,100));}
 if(!ready)throw new Error('Emulator did not start.');
 for(const script of ['scripts/phase5-advance-rules-emulator.mjs','scripts/management-cash-settlement-rules-emulator.mjs','scripts/phase5-financial-reconciliation-emulator.mjs']) {
  const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx',script],{stdio:'inherit',env:{...process.env,FIRESTORE_EMULATOR_HOST:`127.0.0.1:${port}`}});const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error(`${script} timed out.`));},180000);child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('exit',code=>{clearTimeout(timer);resolve(code);});});
  if(code!==0)throw new Error(`${script} failed (${code}).`);
 }
}finally{emulator.kill('SIGTERM');log.end();}
