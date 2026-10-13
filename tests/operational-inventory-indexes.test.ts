import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indexCreateArgs } from '../scripts/deploy-firestore-indexes.mjs';
import { operationalIndexesReady } from '../scripts/verify-operational-inventory-indexes.mjs';

const manifest = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'));
const operational = manifest.indexes.filter((index: { collectionGroup: string }) => index.collectionGroup.startsWith('operational_'));

test('deployment manifest contains all nine Operational Inventory composite indexes', () => {
  assert.equal(operational.length, 9);
  const args = indexCreateArgs(operational.find((index: { collectionGroup: string }) => index.collectionGroup === 'operational_grn_lines'), 'project', 'database');
  assert.ok(args.includes('--collection-group=operational_grn_lines'));
  assert.ok(args.includes('--field-config=field-path=grnId,order=ascending'));
  assert.ok(args.includes('--database=database'));
});

test('operational index verifier requires every exact manifest index to be READY', () => {
  const deployed = operational.map((index: { collectionGroup: string; queryScope: string; fields: Array<{ fieldPath: string; order: string }> }) => ({
    name: `projects/p/databases/d/collectionGroups/${index.collectionGroup}/indexes/example`,
    queryScope: index.queryScope,
    fields: [...index.fields, { fieldPath: '__name__', order: 'ASCENDING' }],
    state: 'READY'
  }));
  assert.equal(operationalIndexesReady(operational, deployed), true);
  assert.equal(operationalIndexesReady(operational, deployed.slice(1)), false);
  assert.equal(operationalIndexesReady(operational, deployed.map((index: { state: string }, i: number) => i === 0 ? { ...index, state: 'CREATING' } : index)), false);
  assert.equal(operationalIndexesReady(operational, deployed.map((index: { fields: unknown[] }, i: number) => i === 0 ? { ...index, fields: [] } : index)), false);
});
