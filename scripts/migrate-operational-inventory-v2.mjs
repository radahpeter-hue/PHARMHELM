import { APPLY, ACCESS_TOKEN, DATABASE_ID, PROJECT_ID, api, documentsRoot, firestoreBase, runQuery, commit } from './firebase-rest-utils.mjs';
import { planOperationalInventoryMigration } from './operational-inventory-migration-core.mjs';

const tenantArg = process.argv.find(arg => arg.startsWith('--tenant='));
const tenantId = tenantArg?.slice('--tenant='.length).trim();
const actorId = process.env.OPERATIONAL_MIGRATION_ACTOR?.trim();
if (!tenantId) throw new Error('Supply exactly one tenant with --tenant=TENANT_ID. The command is preview-only unless --apply is also supplied.');
if (APPLY && !actorId) throw new Error('Set OPERATIONAL_MIGRATION_ACTOR to the accountable operator before applying.');

const decode = value => {
  if (!value || typeof value !== 'object') return value;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, field]) => [key, decode(field)]));
  return undefined;
};
const encode = value => {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, encode(nested)])) } };
};
const normalize = document => ({ id: document.name.split('/').pop(), ...Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, decode(value)])), updateTime: document.updateTime, name: document.name });
const tenantQuery = collectionId => runQuery({
  from: [{ collectionId }],
  where: { fieldFilter: { field: { fieldPath: 'tenantId' }, op: 'EQUAL', value: { stringValue: tenantId } } }
});
const readTenantDocument = async () => {
  try {
    return normalize(await api(`${firestoreBase}/system_settings/${encodeURIComponent(tenantId)}`));
  } catch (error) {
    if (String(error).includes('404')) return null;
    throw error;
  }
};

const [settings, rawItems, rawMasters, rawMovements, rawOrders, rawLines, rawGrns, rawUsage, rawFinance, rawManagementExpenses, rawBranchExpenses, rawProducts, rawAudit] = await Promise.all([
  readTenantDocument(), tenantQuery('operational_inventory'), tenantQuery('operational_inventory_masters'),
  tenantQuery('operational_inventory_movements'), tenantQuery('stock_orders'), tenantQuery('stock_order_lines'),
  tenantQuery('grn_records'), tenantQuery('operational_inventory_usage'), tenantQuery('finance_ledger'),
  tenantQuery('management_expenses'), tenantQuery('branch_expenses'),
  tenantQuery('products'), tenantQuery('operational_inventory_migration_audit')
]);
const unpack = rows => rows.map(normalize);
const items = unpack(rawItems), masters = unpack(rawMasters), movements = unpack(rawMovements);
const orders = unpack(rawOrders), orderLines = unpack(rawLines), grns = unpack(rawGrns);
const usageEntries = unpack(rawUsage), financeEntries = [...unpack(rawFinance), ...unpack(rawManagementExpenses), ...unpack(rawBranchExpenses)], products = unpack(rawProducts), audit = unpack(rawAudit);
const report = planOperationalInventoryMigration({
  tenantId, items, masters, movements, orders, orderLines, grns, usageEntries, financeEntries,
  sellableItemIds: products.map(product => product.id), existingAuditIds: audit.map(row => row.id),
  actorId: actorId || 'operational_inventory_migration'
});
report.mode = APPLY ? 'apply' : 'dry-run';
report.projectId = PROJECT_ID;
report.databaseId = DATABASE_ID;
report.featureEnabled = settings?.tenantId === tenantId && settings?.featureToggles?.enableOperationalInventory === true;
report.itemsMissingHQOperationalLocation = report.missingHqLocations.length;
report.requiresPrivilegedFirestoreAccess = true;

if (APPLY && !report.featureEnabled) throw new Error('Apply blocked: Operational Inventory must be enabled in the tenant System Settings.');
if (APPLY && report.ambiguous.length) throw new Error(`Apply blocked: ${report.ambiguous.length} ambiguous record(s) require manual reconciliation. Review the preview JSON; no writes were made.`);

const refs = collection => `${documentsRoot}/${collection}`;
const addCreate = (collection, id, fields) => ({ update: { name: `${refs(collection)}/${id}`, fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encode(value)])) }, currentDocument: { exists: false } });
const addPatch = (collection, id, fields, snapshot) => {
  if (!snapshot) throw new Error(`Missing update-time precondition for ${collection}/${id}.`);
  return { update: { name: `${refs(collection)}/${id}`, fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encode(value)])) }, updateMask: { fieldPaths: Object.keys(fields) }, currentDocument: { updateTime: snapshot.updateTime } };
};

if (APPLY) {
  if (!ACCESS_TOKEN) throw new Error('No authorised Firestore token is available.');
  const itemById = new Map(items.map(row => [row.id, row]));
  const orderById = new Map(orders.map(row => [row.id, row]));
  const lineById = new Map(orderLines.map(row => [row.id, row]));
  const grnById = new Map(grns.map(row => [row.id, row]));
  const itemPatches = new Map(report.itemBackfills.map(row => [row.id, row]));
  const openingMovements = new Map(report.openingMovements.map(row => [row.itemId, row]));
  const auditByEntity = new Map(report.auditCreates.map(row => [`${row.entityType}:${row.entityId}`, row]));
  const auditWrite = (type, id) => {
    const row = auditByEntity.get(`${type}:${id}`);
    return row ? addCreate('operational_inventory_migration_audit', row.id, { ...row, operator: actorId }) : null;
  };
  let writesCommitted = 0;
  const atomicCommit = async writes => {
    const batch = writes.filter(Boolean);
    if (!batch.length) return;
    if (batch.length > 450) throw new Error('A migration transaction exceeded the safe write limit.');
    await commit(batch);
    writesCommitted += batch.length;
  };

  // Create tenant-wide masters first. Each creation and its immutable audit row commit together.
  for (const row of report.masterCreates) await atomicCommit([
    addCreate('operational_inventory_masters', row.id, row), auditWrite('master', row.id)
  ]);
  // Each location balance, opening movement and audit record is one atomic, rerunnable unit.
  for (const auditRow of auditByEntity.values()) {
    if (!auditRow || auditRow.entityType !== 'item') continue;
    const itemId = auditRow.entityId;
    const patch = itemPatches.get(itemId);
    const opening = openingMovements.get(itemId);
    await atomicCommit([
      patch ? addPatch('operational_inventory', itemId, patch.patch, itemById.get(itemId)) : null,
      opening ? addCreate('operational_inventory_movements', opening.id, opening) : null,
      auditWrite('item', itemId)
    ]);
  }
  for (const row of report.orderBackfills) await atomicCommit([
    addPatch('stock_orders', row.id, { inventoryClass: row.inventoryClass }, orderById.get(row.id)), auditWrite('order', row.id)
  ]);
  for (const row of report.lineBackfills) await atomicCommit([
    addPatch('stock_order_lines', row.id, { inventoryClass: row.inventoryClass }, lineById.get(row.id)), auditWrite('line', row.id)
  ]);
  for (const row of report.grnBackfills) await atomicCommit([
    addPatch('grn_records', row.id, { inventoryClass: row.inventoryClass, ...(row.historicalFinanceReviewRequired ? { historicalFinanceReviewRequired: true } : {}) }, grnById.get(row.id)), auditWrite('grn', row.id)
  ]);
  // Audit any already-classified source records that required no field backfill.
  for (const row of report.auditCreates) {
    if (row.entityType === 'master' && report.masterCreates.some(master => master.id === row.entityId)) continue;
    if (row.entityType === 'item' && auditByEntity.has(`item:${row.entityId}`)) continue;
    if (row.entityType === 'order' && report.orderBackfills.some(order => order.id === row.entityId)) continue;
    if (row.entityType === 'line' && report.lineBackfills.some(line => line.id === row.entityId)) continue;
    if (row.entityType === 'grn' && report.grnBackfills.some(grn => grn.id === row.entityId)) continue;
    await atomicCommit([addCreate('operational_inventory_migration_audit', row.id, { ...row, operator: actorId })]);
  }
  report.writesCommitted = writesCommitted;
}

console.log(JSON.stringify(report, null, 2));
