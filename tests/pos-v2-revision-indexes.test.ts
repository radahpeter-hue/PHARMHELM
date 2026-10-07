import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { revisionLedgerIndexesReady } from '../scripts/verify-pos-v2-revision-indexes.mjs';

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
  assert.match(workflow, /deploy --only firestore:indexes/);
  assert.ok(workflow.indexOf('Deploy Firestore indexes') < workflow.indexOf('Verify revision-ledger indexes are ready'));
  assert.ok(workflow.indexOf('Verify revision-ledger indexes are ready') < workflow.indexOf('Deploy Firebase Hosting'));
});
