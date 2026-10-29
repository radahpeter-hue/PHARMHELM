import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

const jar = process.env.FIRESTORE_EMULATOR_JAR || join(tmpdir(), 'pharmhelm-firestore-emulator-v1.19.8.jar');
const expectedHash = '9d43599ed6151199e8d604dc87fac51218e49e5f3a48519b1ae560bbe5e3382d';
if (!existsSync(jar)) {
  const response = await fetch('https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v1.19.8.jar');
  if (!response.ok) throw new Error(`Emulator download failed (${response.status}).`);
  writeFileSync(jar, Buffer.from(await response.arrayBuffer()));
}
if (createHash('sha256').update(readFileSync(jar)).digest('hex') !== expectedHash) throw new Error('Firestore emulator checksum mismatch.');
const port = Number(process.env.SPARK_EMULATOR_PORT || 8088);
const log = createWriteStream(join(tmpdir(), 'pharmhelm-spark-emulator.log'));
const emulator = spawn('java', ['-jar', jar, '--host', '127.0.0.1', '--port', String(port), '--project_id', 'demo-pharmhelm-spark-production']);
emulator.stdout.pipe(log); emulator.stderr.pipe(log);
let launchError;
emulator.on('error', error => { launchError = error; });
const canConnect = () => new Promise(resolve => {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  socket.on('connect', () => { socket.destroy(); resolve(true); });
  socket.on('error', () => { socket.destroy(); resolve(false); });
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (launchError) throw launchError;
    if (emulator.exitCode !== null) throw new Error('Firestore emulator exited during startup.');
    if (await canConnect()) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Firestore emulator did not start.');
  for (const script of process.env.EOD_LEVEL3_ONLY ? ['scripts/eod-level3-emulator.mjs'] : ['scripts/eod-level3-emulator.mjs', 'scripts/staff-identity-eod-rules-emulator.mjs', 'scripts/system-identity-rules-emulator.mjs', 'scripts/martin-pharma-identity-staging-emulator.mjs']) {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', script], { stdio: 'inherit',
        env: { ...process.env, FIRESTORE_EMULATOR_HOST: `127.0.0.1:${port}` } });
      const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`${script} timed out.`)); }, 180000);
      child.on('error', error => { clearTimeout(timeout); reject(error); });
      child.on('exit', code => { clearTimeout(timeout); resolve(code); });
    });
    if (code !== 0) throw new Error(`${script} failed (${code}).`);
  }
} finally { emulator.kill('SIGTERM'); log.end(); }
