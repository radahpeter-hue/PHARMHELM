import test from 'node:test';
import assert from 'node:assert/strict';
import { planOperationalIdentityBackfill } from '../src/services/operationalIdentityMigrationPolicy';
import { deterministicOperationalIdentityClaimId, operationalIdentityFingerprint } from '../src/services/operationalIdentity';
const item = { id: 'legacy-pens', tenantId: 'tenant-a', branchId: 'Masaka', name: 'Pens', category: 'Stationery', type: 'non-fixed', unitPerPack: 12, unitOfIssue: 'pen', quantityInStock: 30 };
const plan = (extra: any = {}) => planOperationalIdentityBackfill({ tenantId: 'tenant-a', items: [item], masters: [], claims: [], actorId: 'reviewer', now: '2026-10-13', ...extra });
test('identity backfill preserves legacy IDs and never changes stock or financial records', () => {
  const result = plan();
  assert.equal(result.ready, true);
  const master = result.writes.find(row => row.collection === 'operational_inventory_masters')!;
  assert.equal(master.id, item.id);
  const patch = result.writes.find(row => row.collection === 'operational_inventory')!;
  assert.equal(patch.id, item.id);
  assert.equal(patch.fields.masterItemId, item.id);
  assert.ok(!('quantityInStock' in patch.fields));
  assert.ok(!result.writes.some(row => /finance|movement/.test(row.collection)));
  assert.ok(result.writes.some(row => row.collection === 'operational_inventory_migration_audit'));
});
test('cross-branch duplicates stop all writes until explicitly reviewed and linked', () => {
  const second = { ...item, id: 'other-pens', branchId: 'HQ' };
  assert.equal(plan({ items: [item, second] }).ready, false);
  assert.deepEqual(plan({ items: [item, second] }).writes, []);
  const linked = plan({ items: [item, second], reviewedLinks: { 'other-pens': item.id } });
  assert.equal(linked.ready, true);
  assert.equal(linked.writes.filter(row => row.collection === 'operational_inventory_masters').length, 1);
  assert.equal(linked.writes.find(row => row.collection === 'operational_inventory_masters')?.fields.hqLocationItemId, second.id);
});
test('Sellable, mixed identity, missing master and duplicate location records fail closed', () => {
  assert.equal(plan({ items: [{ ...item, inventoryClass: 'SELLABLE' }] }).ready, false);
  assert.equal(plan({ items: [{ ...item, masterItemId: 'missing' }] }).ready, false);
  assert.equal(plan({ items: [item, { ...item, id: 'copy' }], reviewedLinks: { copy: item.id } }).ready, false);
});
test('completed identity backfill is idempotent and excludes other tenants', () => {
  const fingerprint = operationalIdentityFingerprint(item as any);
  const claimId = deterministicOperationalIdentityClaimId(item.tenantId, fingerprint);
  const master = { ...item, inventoryClass: 'OPERATIONAL', operationalType: 'CONSUMABLE_OPERATIONAL', identityClaimId: claimId };
  const result = plan({ items: [{ ...master, masterItemId: item.id }, { ...item, id: 'foreign', tenantId: 'tenant-b' }], masters: [master], claims: [{ id: claimId, tenantId: item.tenantId, inventoryClass: 'OPERATIONAL', identityFingerprint: fingerprint, masterItemId: item.id }] });
  assert.equal(result.ready, true); assert.deepEqual(result.writes, []);
});
