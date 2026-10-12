import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const normalizedFields = index => (index.fields || []).filter(field => field.fieldPath !== '__name__')
  .map(field => `${field.fieldPath}:${field.order || field.arrayConfig}`).join('|');
const collectionGroup = index => index.collectionGroup
  || index.name?.match(/\/collectionGroups\/([^/]+)\/indexes\//)?.[1];

export function operationalIndexesReady(required, deployed) {
  return required.every(candidate => deployed.some(index => index.queryScope === candidate.queryScope
    && index.state === 'READY' && collectionGroup(index) === candidate.collectionGroup
    && normalizedFields(index) === normalizedFields(candidate)));
}

export function loadCompositeIndexes(project, database, run = execFileSync) {
  const output = run('gcloud', ['firestore', 'indexes', 'composite', 'list',
    `--project=${project}`, `--database=${database}`, '--format=json'],
  { encoding: 'utf8', timeout: 30000 });
  return JSON.parse(output);
}

async function verify() {
  const project = process.env.FIREBASE_PROJECT_ID;
  const database = process.env.FIRESTORE_DATABASE_ID;
  if (!project || !database) throw new Error('Firebase project and named database are required.');
  const required = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')).indexes
    .filter(index => index.collectionGroup.startsWith('operational_'));
  if (required.length !== 8) throw new Error(`Expected eight Operational Inventory indexes; found ${required.length}.`);

  for (let attempt = 0; attempt < 40; attempt++) {
    const deployed = loadCompositeIndexes(project, database);
    if (operationalIndexesReady(required, deployed)) {
      console.log(`All ${required.length} Operational Inventory composite indexes are READY in ${database}.`);
      return;
    }
    if (deployed.some(index => index.state === 'NEEDS_REPAIR' && required.some(candidate =>
      candidate.collectionGroup === collectionGroup(index) && normalizedFields(candidate) === normalizedFields(index)))) {
      throw new Error('An Operational Inventory composite index needs repair. The workflow cannot report success.');
    }
    console.log(`Waiting for Operational Inventory indexes to become READY (${attempt + 1}/40).`);
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
  throw new Error('Operational Inventory indexes did not become READY within 10 minutes.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await verify();
