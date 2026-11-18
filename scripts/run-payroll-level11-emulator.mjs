import {spawn} from 'node:child_process';
import {existsSync,createWriteStream} from 'node:fs';
import {homedir} from 'node:os';
import net from 'node:net';
const jar=process.env.FIRESTORE_EMULATOR_JAR || homedir()+'/.cache/firebase/emulators/cloud-firestore-emulator-v1.20.2.jar';
if(!existsSync(jar))throw new Error('Install the Firestore emulator with firebase setup:emulators:firestore.');
const port=Number(process.env.PAYROLL_EMULATOR_PORT || 39367);
const log=createWriteStream('/tmp/pharmhelm-payroll11-firestore.log');
const java=spawn('java',['-Xmx2g','-jar',jar,'--host','127.0.0.1','--port',String(port),'--project_id','demo-pharmhelm-payroll11']);
java.stdout.pipe(log);java.stderr.pipe(log);
const ready=()=>new Promise(resolve=>{const s=net.createConnection({host:'127.0.0.1',port});s.on('connect',()=>{s.destroy();resolve(true);});s.on('error',()=>resolve(false));});
try{
 let connected=false;
 for(let i=0;i<200;i++){if(java.exitCode!==null)throw new Error('Firestore emulator exited.');if(await ready()){connected=true;break;}await new Promise(r=>setTimeout(r,100));}
 if(!connected)throw new Error('Firestore emulator did not start.');
 for(const script of process.argv.slice(2).length?process.argv.slice(2):['scripts/payroll-level11-rules-emulator.mjs']){
  const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx',script],{stdio:'inherit',env:{...process.env,FIRESTORE_EMULATOR_HOST:'127.0.0.1:'+port}});child.on('error',reject);child.on('exit',resolve);});
  if(code!==0)throw new Error(script+' failed: '+code);
 }
}finally{java.kill('SIGTERM');log.end();}
