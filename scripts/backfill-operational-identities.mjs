// Run with node --import tsx. Preview is the default; apply requires a frozen feature toggle.
import { readFileSync } from 'node:fs';
import { planOperationalIdentityBackfill } from '../src/services/operationalIdentityMigrationPolicy.ts';
import { api, runQuery, commit, firestoreBase, documentsRoot, APPLY } from './firebase-rest-utils.mjs';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
let tenantId = arg('tenant');
if (!tenantId && arg('slug')) {
  const tenants = await runQuery({ from: [{ collectionId: 'tenants' }], where: { fieldFilter: { field: { fieldPath: 'slug' }, op: 'EQUAL', value: { stringValue: arg('slug') } } } });
  if (tenants.length !== 1) throw new Error('Tenant slug must resolve to exactly one tenant.');
  tenantId = tenants[0].name.split('/').pop();
}
const actorId = arg('actor');
if (!tenantId || !actorId) throw new Error('--tenant and --actor are required.');
const decode = value => value.stringValue ?? (value.integerValue !== undefined ? Number(value.integerValue) : value.doubleValue ?? value.booleanValue ?? value.timestampValue ?? (value.mapValue ? Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k,v]) => [k, decode(v)])) : null));
const encode = value => value === null ? { nullValue: null } : typeof value === 'boolean' ? { booleanValue: value } : typeof value === 'number' ? (Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }) : typeof value === 'string' ? { stringValue: value } : { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k,v]) => [k, encode(v)])) } };
const unpack = document => ({ id: document.name.split('/').pop(), ...Object.fromEntries(Object.entries(document.fields || {}).map(([k,v]) => [k, decode(v)])), updateTime: document.updateTime });
const names = ['operational_inventory', 'operational_inventory_masters', 'operational_inventory_identity_claims'];
const rows = await Promise.all(names.map(collectionId => runQuery({ from: [{ collectionId }], where: { fieldFilter: { field: { fieldPath: 'tenantId' }, op: 'EQUAL', value: { stringValue: tenantId } } } }).then(docs => docs.map(unpack))));
const settingsRaw = await api(`${firestoreBase}/system_settings/${encodeURIComponent(tenantId)}`);
const settings = unpack(settingsRaw);
if (settings.tenantId !== tenantId) throw new Error('Tenant settings mismatch.');
const report = planOperationalIdentityBackfill({ tenantId, items: rows[0], masters: rows[1], claims: rows[2], actorId,
  now: new Date().toISOString(), reviewedLinks: arg('links') ? JSON.parse(readFileSync(arg('links'), 'utf8')) : {} });
console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'preview', ...report }, null, 2));
if (APPLY) {
  if (!report.ready) throw new Error('Reconcile conflicts before applying.');
  if (settings.featureToggles?.enableOperationalInventory !== false) throw new Error('Disable Operational Inventory in System Settings before applying to freeze client writes.');
  const writes = report.writes.map(write => {
    const old = rows[names.indexOf(write.collection)]?.find(row => row.id === write.id);
    if (!write.create && !old?.updateTime) throw new Error(`Missing version for ${write.collection}/${write.id}`);
    return { update: { name: `${documentsRoot}/${write.collection}/${write.id}`, fields: Object.fromEntries(Object.entries(write.fields).map(([k,v]) => [k, encode(v)])) },
      ...(write.create ? {} : { updateMask: { fieldPaths: Object.keys(write.fields) } }),
      currentDocument: write.create ? { exists: false } : { updateTime: old.updateTime } };
  });
  // Include unchanged sources and settings as preconditions to catch changes since preview/read.
  const changed = new Set(report.writes.map(write => `${write.collection}/${write.id}`));
  for (let i = 0; i < names.length; i++) for (const row of rows[i]) if (!changed.has(`${names[i]}/${row.id}`)) writes.push({ verify: `${documentsRoot}/${names[i]}/${row.id}`, currentDocument: { updateTime: row.updateTime } });
  writes.push({ verify: settingsRaw.name, currentDocument: { updateTime: settingsRaw.updateTime } });
  writes.push({ update: { name: `${documentsRoot}/operational_inventory_identity_state/${tenantId}`, fields: {
    tenantId: encode(tenantId), status: encode('READY'), actorId: encode(actorId), completedAt: encode(new Date().toISOString()),
    ...(arg('enabled-before') ? { enabledBeforeBackfill: encode(arg('enabled-before') === 'true'), settingsFrozenVersion: encode(arg('frozen-version') || '') } : {})
  } }, currentDocument: { exists: false } });
  if (writes.length > 450) throw new Error('Atomic backfill exceeds 450 writes. Use a staged reviewed migration; readiness was not changed.');
  await commit(writes);
  console.log('Identity backfill committed atomically. Re-enable Operational Inventory after verification.');
}
