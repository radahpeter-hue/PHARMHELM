import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function indexCreateArgs(index, project, database) {
  const fields = (index.fields || []).filter(field => field.fieldPath !== '__name__');
  if (!index.collectionGroup || !['COLLECTION', 'COLLECTION_GROUP'].includes(index.queryScope) || fields.length < 2) {
    throw new Error('Composite index manifest contains an invalid collection, scope, or field list.');
  }
  return [
    'firestore', 'indexes', 'composite', 'create',
    `--project=${project}`,
    `--database=${database}`,
    `--collection-group=${index.collectionGroup}`,
    `--query-scope=${index.queryScope.toLowerCase()}`,
    ...fields.map(field => `--field-config=field-path=${field.fieldPath},order=${field.order.toLowerCase()}`),
    '--async', '--quiet'
  ];
}

export function deployCompositeIndexes(indexes, project, database, run = execFileSync) {
  for (const index of indexes) {
    const args = indexCreateArgs(index, project, database);
    const label = `${index.collectionGroup}: ${(index.fields || []).map(field => field.fieldPath).join(', ')}`;
    try {
      const output = run('gcloud', args, { encoding: 'utf8', timeout: 60000 });
      console.log(output.trim() || `Created/checking index ${label}`);
    } catch (error) {
      const output = `${error.stdout || ''}\n${error.stderr || ''}\n${error.message || ''}`;
      if (/already exists|ALREADY_EXISTS/i.test(output)) {
        console.log(`Index already exists: ${label}`);
        continue;
      }
      throw new Error(`Failed to create composite index ${label}: ${output.trim()}`);
    }
  }
}

function run() {
  const project = process.env.FIREBASE_PROJECT_ID;
  const database = process.env.FIRESTORE_DATABASE_ID;
  if (!project || !database) throw new Error('Firebase project and named database are required.');
  const manifest = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'));
  if (!Array.isArray(manifest.indexes) || manifest.indexes.length === 0) throw new Error('Firestore composite index manifest is empty.');
  deployCompositeIndexes(manifest.indexes, project, database);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
