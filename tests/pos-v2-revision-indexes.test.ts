import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { revisionLedgerIndexesReady, loadRevisionLedgerIndexes } from '../scripts/verify-pos-v2-revision-indexes.mjs';

const required = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')).indexes
  .filter((index: any) => index.collectionGroup === 'pos_sale_revision_requests');
const ready = required.map((index: any) => ({ ...index, state: 'READY', fields: [...index.fields, { fieldPath: '__name__', order: 'DESCENDING' }] }));

test('revision-ledger release accepts both exact READY indexes including the implicit document key', () => {
  assert.equal(revisionLedgerIndexesReady(required, ready), true);
});
test('revision-ledger release blocks missing or still-building branch indexes', () => {
  assert.equal(revisionLedgerIndexesReady(required, ready.slice(0, 1)), false);
  assert.equal(revisionLedgerIndexesReady(required, [ready[0], { ...ready[1], state: 'CREATING' }]), false);
});
test('revision-ledger release rejects a different field order or query scope', () => {
  assert.equal(revisionLedgerIndexesReady(required, [ready[0], { ...ready[1], fields: [...ready[1].fields].reverse() }]), false);
  assert.equal(revisionLedgerIndexesReady(required, ready.map((index: any) => ({ ...index, queryScope: 'COLLECTION_GROUP' }))), false);
});
test('deployment creates and verifies the named-database indexes before releasing Hosting', () => {
  const workflow = readFileSync('.github/workflows/firebase-deploy.yml', 'utf8');
  assert.match(workflow, /gcloud firestore indexes composite create/);
  assert.match(workflow, /--collection-group=pos_sale_revision_requests/);
  assert.doesNotMatch(workflow, /deploy --only firestore:indexes/);
  assert.ok(workflow.indexOf('Deploy Firestore indexes') < workflow.indexOf('Verify revision-ledger indexes are ready'));
  assert.ok(workflow.indexOf('Verify revision-ledger indexes are ready') < workflow.indexOf('Deploy Firebase Hosting'));
});

test('production readiness reads the named database through gcloud and excludes other collections', () => {
  const deployed = loadRevisionLedgerIndexes('project-a', 'named-db-a', (command: string, args: string[]) => {
    assert.equal(command, 'gcloud');
    assert.deepEqual(args, ['firestore', 'indexes', 'composite', 'list', '--project=project-a', '--database=named-db-a', '--format=json']);
    return JSON.stringify([
      ...ready.map((index: any, i: number) => ({ ...index, name: `projects/project-a/databases/named-db-a/collectionGroups/other/indexes/${i}` })),
      ...ready.map((index: any, i: number) => ({ ...index, state: 'CREATING', name: `projects/project-a/databases/named-db-a/collectionGroups/pos_sale_revision_requests/indexes/${i}` }))
    ]);
  });
  assert.equal(deployed.length, 2);
  assert.equal(revisionLedgerIndexesReady(required, deployed), false);
});
