/**
 * Read-only historical identity reconciliation planner.
 * Takes exported Firestore document snapshots; never writes to the database.
 * All proposed codes must be reviewed before a separate authorized migration.
 */
const DEFINITIONS = {
  tenants: { prefix: 'TEN', field: 'tenant_code', kind: 'tenants', scope: 'platform' },
  branches: { prefix: 'BR', field: 'branch_code', kind: 'branches' },
  clients: { prefix: 'PAT', field: 'patient_code', kind: 'patients' },
  prescribers: { prefix: 'PRE', field: 'prescriber_code', kind: 'prescribers' },
  institutions: { prefix: 'INS', field: 'institution_code', kind: 'institutions' },
  products: { prefix: 'PRD', field: 'productId', kind: 'products' },
  staff: { prefix: 'STF', field: 'employee_id', kind: 'staff' }
};

function plan(records, counters = []) {
  const plans = [];
  const nextByCounter = new Map(counters.map(c => [c.id, Number(c.lastSequence || 0)]));
  const groups = Object.keys(DEFINITIONS);
  for (const collectionName of groups) {
    const definition = DEFINITIONS[collectionName];
    for (const record of [...(records[collectionName] || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
      if (!record.id) throw new Error(`Record in ${collectionName} lacks a Firestore document ID`);
      const scope = definition.scope === 'platform' ? 'platform' : record.tenantId;
      if (!scope) throw new Error(`Record ${collectionName}/${record.id} has no tenantId`);
      const counterId = definition.scope === 'platform' ? 'platform_tenants' : `${scope}_${definition.kind}`;
      const existing = String(record[definition.field] || '').trim();
      const match = new RegExp(`^${definition.prefix}-(\\d+)$`).exec(existing);
      if (match) nextByCounter.set(counterId, Math.max(nextByCounter.get(counterId) || 0, Number(match[1])));
      if (existing) {
        plans.push({ collection: collectionName, id: record.id, tenantId: record.tenantId || '', status: 'PRESERVE', field: definition.field, existingCode: existing });
        continue;
      }
      const next = (nextByCounter.get(counterId) || 0) + 1;
      nextByCounter.set(counterId, next);
      plans.push({ collection: collectionName, id: record.id, tenantId: record.tenantId || '', status: 'PROPOSE', field: definition.field, proposedCode: `${definition.prefix}-${String(next).padStart(6, '0')}`, counterId });
    }
  }
  return plans;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/identity-backfill-preview.mjs <exported-documents.json> [output.json]');
    process.exit(2);
  }
  const input = JSON.parse(readFileSync(file, 'utf8'));
  const proposed = plan(input.collections || {}, input.identity_sequence_counters || []);
  const output = JSON.stringify({ mode: 'READ_ONLY', total: proposed.length, proposed: proposed.filter(r => r.status === 'PROPOSE').length, records: proposed }, null, 2);
  if (process.argv[3]) writeFileSync(process.argv[3], output);
  else process.stdout.write(output + '\n');
}

export { plan as planIdentityBackfill };
