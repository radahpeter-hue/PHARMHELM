import { deterministicOperationalIdentityClaimId, operationalIdentityFingerprint } from './operationalIdentity';

type Row = Record<string, any> & { id: string; tenantId: string };
export interface IdentityMigrationWrite { collection: string; id: string; fields: Record<string, any>; create: boolean }

/** Preview-only policy. Never merges identities without a reviewed item-to-master mapping. */
export function planOperationalIdentityBackfill(input: {
  tenantId: string; items: Row[]; masters: Row[]; claims: Row[];
  reviewedLinks?: Record<string, string>; actorId: string; now: string;
}) {
  const { tenantId, actorId, now } = input;
  const writes: IdentityMigrationWrite[] = [];
  const conflicts: string[] = [];
  const masters = new Map(input.masters.filter(row => row.tenantId === tenantId).map(row => [row.id, { ...row }]));
  const identities = new Map<string, string>();
  const locations = new Set<string>();
  const claimById = new Map(input.claims.filter(row => row.tenantId === tenantId).map(row => [row.id, row]));
  const valid = (row: Row) => row.inventoryClass !== 'SELLABLE' && row.name?.trim() &&
    ['fixed', 'non-fixed'].includes(row.type) && (!row.operationalType || row.operationalType === (row.type === 'fixed' ? 'FIXED_ASSET' : 'CONSUMABLE_OPERATIONAL')) && Number.isInteger(row.unitPerPack) && row.unitPerPack > 0 &&
    typeof row.unitOfIssue === 'string' && [row.name, row.category || '', row.unitOfIssue].every(value => typeof value === 'string' && !value.includes('|'));
  const reserve = (master: Row) => {
    if (!valid(master) || master.inventoryClass !== 'OPERATIONAL') { conflicts.push(`Invalid master ${master.id}`); return; }
    const fingerprint = operationalIdentityFingerprint(master as any);
    const previous = identities.get(fingerprint);
    if (previous && previous !== master.id) conflicts.push(`Duplicate identity: ${previous}, ${master.id}. Supply reviewed links; existing masters are never merged.`);
    identities.set(fingerprint, master.id);
  };
  masters.forEach(reserve);
  for (const item of input.items.filter(row => row.tenantId === tenantId)) {
    if (!valid(item) || !item.branchId || (item.inventoryClass && item.inventoryClass !== 'OPERATIONAL')) {
      conflicts.push(`Invalid or non-Operational location ${item.id}`); continue;
    }
    const fingerprint = operationalIdentityFingerprint(item as any);
    const selectedId = item.masterItemId || input.reviewedLinks?.[item.id] || item.id;
    const selected = masters.get(selectedId);
    if (selected && operationalIdentityFingerprint(selected as any) !== fingerprint) {
      conflicts.push(`Identity mismatch for ${item.id} and ${selectedId}`); continue;
    }
    if (item.masterItemId && !selected) { conflicts.push(`Missing master ${selectedId} for ${item.id}`); continue; }
    const previous = identities.get(fingerprint);
    if (previous && previous !== selectedId) { conflicts.push(`Review ${item.id}: matching identity belongs to ${previous}. Explicit linking is required.`); continue; }
    const locationKey = `${selectedId}|${item.branchId}`;
    if (locations.has(locationKey)) { conflicts.push(`Multiple location records for ${locationKey}`); continue; }
    locations.add(locationKey);
    if (!selected) {
      const master = { id: selectedId, tenantId, name: item.name, category: item.category || '', type: item.type,
        operationalType: item.type === 'fixed' ? 'FIXED_ASSET' : 'CONSUMABLE_OPERATIONAL', inventoryClass: 'OPERATIONAL',
        unitPerPack: item.unitPerPack, unitOfIssue: item.unitOfIssue, uniqueId: item.uniqueId || '', sku: item.sku || '',
        description: item.description || '', supplier: item.supplier || '', createdAt: now, updatedAt: now };
      masters.set(selectedId, master); reserve(master);
    }
    const master = masters.get(selectedId)!;
    if (item.branchId === 'HQ') {
      if (master.hqLocationItemId && master.hqLocationItemId !== item.id) conflicts.push(`Conflicting HQ location for ${selectedId}`);
      master.hqLocationItemId = item.id;
    }
    if (!item.masterItemId || !item.inventoryClass || !item.operationalType) {
      writes.push({ collection: 'operational_inventory', id: item.id, create: false, fields: {
        masterItemId: selectedId, inventoryClass: 'OPERATIONAL', operationalType: master.operationalType, updatedAt: now
      } });
      writes.push({ collection: 'operational_inventory_migration_audit', id: `identity_v1_${item.id}`, create: true,
        fields: { tenantId, itemId: item.id, masterItemId: selectedId, actorId, eventType: 'LEGACY_IDENTITY_LINKED',
          previousMasterItemId: item.masterItemId || null, previousInventoryClass: item.inventoryClass || null,
          previousOperationalType: item.operationalType || null, createdAt: now } });
    }
  }
  for (const master of masters.values()) {
    const fingerprint = operationalIdentityFingerprint(master as any);
    const claimId = deterministicOperationalIdentityClaimId(tenantId, fingerprint);
    const claim = claimById.get(claimId);
    if (claim && (claim.masterItemId !== master.id || claim.identityFingerprint !== fingerprint || claim.inventoryClass !== 'OPERATIONAL')) {
      conflicts.push(`Conflicting identity claim for ${master.id}`); continue;
    }
    const existing = input.masters.find(row => row.id === master.id && row.tenantId === tenantId);
    if (!existing) writes.push({ collection: 'operational_inventory_masters', id: master.id, create: true,
      fields: { ...master, identityClaimId: claimId } });
    else if (existing.identityClaimId !== claimId || existing.hqLocationItemId !== master.hqLocationItemId) {
      writes.push({ collection: 'operational_inventory_masters', id: master.id, create: false,
        fields: { identityClaimId: claimId, ...(master.hqLocationItemId ? { hqLocationItemId: master.hqLocationItemId } : {}), updatedAt: now } });
    }
    if (!claim) writes.push({ collection: 'operational_inventory_identity_claims', id: claimId, create: true,
      fields: { tenantId, inventoryClass: 'OPERATIONAL', identityFingerprint: fingerprint, masterItemId: master.id, actorId, createdAt: now } });
  }
  const reviewItems = input.items.filter(row => row.tenantId === tenantId).map(row => ({
    id: row.id, name: row.name ?? null, branchId: row.branchId ?? null, inventoryClass: row.inventoryClass ?? null,
    type: row.type ?? null, operationalType: row.operationalType ?? null, category: row.category ?? null,
    unitPerPack: row.unitPerPack ?? null, unitOfIssue: row.unitOfIssue ?? null, masterItemId: row.masterItemId ?? null
  }));
  return { tenantId, reviewItems, conflicts, writes: conflicts.length ? [] : writes, ready: conflicts.length === 0 };
}
