import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const fields = index => (index.fields || []).filter(field => field.fieldPath !== '__name__')
  .map(field => `${field.fieldPath}:${field.order}`).join('|');

export function revisionLedgerIndexesReady(required, deployed) {
  return required.every(candidate => deployed.some(index => index.queryScope === candidate.queryScope
    && index.state === 'READY' && fields(index) === fields(candidate)));
}

export function loadRevisionLedgerIndexes(project, database, runCommand = execFileSync) {
  const output = runCommand('gcloud', ['firestore', 'indexes', 'composite', 'list',
    `--project=${project}`, `--database=${database}`, '--format=json'],
  { encoding: 'utf8', timeout: 30000 });
  return JSON.parse(output).filter(index => index.name?.includes('/collectionGroups/pos_sale_revision_requests/indexes/'));
}

async function verify() {
  const project = process.env.FIREBASE_PROJECT_ID;
  const database = process.env.FIRESTORE_DATABASE_ID;
  if (!project || !database) throw new Error('Firebase project and named database are required.');
  const required = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')).indexes
    .filter(index => index.collectionGroup === 'pos_sale_revision_requests');
  if (required.length !== 2) throw new Error('Expected both tenant and branch revision-ledger indexes.');
  for (let attempt = 0; attempt < 40; attempt++) {
    const deployed = loadRevisionLedgerIndexes(project, database);
    if (revisionLedgerIndexesReady(required, deployed)) {
      console.log(`Both revision-ledger indexes are READY in named database ${database}.`);
      return;
    }
    if (deployed.some(index => required.some(candidate => fields(index) === fields(candidate)) && index.state === 'NEEDS_REPAIR')) {
      throw new Error('A required revision-ledger index needs repair. Hosting remains blocked.');
    }
    console.log(`Waiting for revision-ledger indexes to become READY (${attempt + 1}/40).`);
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
  throw new Error('Revision-ledger indexes did not become READY within 10 minutes. Hosting remains blocked.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await verify();
