import { operationalIssueUnit, validateOperationalOpeningStock } from '../utils/operationalStock';
import type { Firestore } from 'firebase/firestore';
import { collection, doc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { db } from '../firebase';
import { OperationalInventory, OperationalInventoryMaster } from '../types';
import { deterministicOperationalIdentityClaimId, deterministicOperationalLocationId, deterministicOperationalMasterId, operationalIdentityFingerprint } from './operationalIdentity';
import { formatSystemIdentity } from './systemIdentityService';

type OperationalItemWrite = Omit<OperationalInventory, 'id' | 'masterItemId'>;

export interface SaveOperationalLocationItemInput {
  tenantId: string;
  branchId: string;
  actor: { uid: string; name?: string };
  data: OperationalItemWrite;
  itemId?: string;
  masterItemId?: string;
}

function masterFields(data: OperationalItemWrite, now: string): Omit<OperationalInventoryMaster, 'id' | 'tenantId' | 'createdAt'> {
  return {
    inventoryClass: 'OPERATIONAL',
    operationalType: data.operationalType || (data.type === 'fixed' ? 'FIXED_ASSET' : 'CONSUMABLE_OPERATIONAL'),
    type: data.type,
    name: data.name.trim(),
    category: data.category,
    uniqueId: data.uniqueId || '',
    sku: data.sku || '',
    unitPerPack: data.unitPerPack,
    unitOfIssue: data.unitOfIssue,
    description: data.description || '',
    supplier: data.supplier || '',
    updatedAt: now
  };
}

/**
 * Saves the location record and its tenant-wide Operational item identity in
 * one transaction. Existing legacy records acquire a stable master identity
 * based on their current document ID when they are next edited.
 */
export async function saveOperationalLocationItem(input: SaveOperationalLocationItemInput, connection: Firestore = db): Promise<{ itemId: string; masterItemId: string }> {
  const tenantId = input.tenantId.trim();
  const branchId = input.branchId.trim();
  if (!tenantId || !branchId || !input.actor?.uid || !input.data.name.trim()) {
    throw new Error('Tenant, location, user and Operational item name are required.');
  }
  if (input.data.inventoryClass !== 'OPERATIONAL' || !['CONSUMABLE_OPERATIONAL', 'FIXED_ASSET'].includes(input.data.operationalType || '')) {
    throw new Error('Operational item classification is required.');
  }

  const openingStock = validateOperationalOpeningStock(input.data.quantityInStock);
  if (!input.itemId && !input.masterItemId && !operationalIssueUnit(input.data.unitOfIssue)) {
    throw new Error('Use a named issue unit such as piece, sheet or roll, not a numeric quantity.');
  }
  const fingerprint = operationalIdentityFingerprint(input.data);
  const requestedMasterId = input.masterItemId || input.itemId || deterministicOperationalMasterId(tenantId, fingerprint);
  const itemRef = input.itemId
    ? doc(connection, 'operational_inventory', input.itemId)
    : doc(connection, 'operational_inventory', deterministicOperationalLocationId(tenantId, requestedMasterId, branchId));
  const masterItemId = requestedMasterId;
  const masterRef = doc(connection, 'operational_inventory_masters', masterItemId);
  const identityClaimId = deterministicOperationalIdentityClaimId(tenantId, fingerprint);
  const identityClaimRef = doc(connection, 'operational_inventory_identity_claims', identityClaimId);
  const identityAuditRef = doc(connection, 'operational_inventory_identity_events', `opidentity_${itemRef.id}`);
  const openingMovementKey = `op_opening_${itemRef.id}`;
  const openingMovementRef = doc(connection, 'operational_inventory_movements', `opm_${openingMovementKey}`);
  const codeKind = input.data.operationalType === 'FIXED_ASSET' ? 'operational_assets' : 'operational_consumables';
  const codePrefix = codeKind === 'operational_assets' ? 'AST' : 'OPS';
  const counterRef = doc(connection, 'identity_sequence_counters', `${tenantId}_${codeKind}`);
  const settingsRef = doc(connection, 'system_settings', tenantId);
  const identityStateRef = doc(connection, 'operational_inventory_identity_state', tenantId);
  const now = new Date().toISOString();
  if (!Number.isInteger(input.data.unitPerPack) || input.data.unitPerPack <= 0 ||
      [input.data.name, input.data.category || '', input.data.unitOfIssue].some(value => value.includes('|')) || new TextEncoder().encode(`${tenantId}|${fingerprint}`).length > 1000) {
    throw new Error('Use a positive whole number of units per pack and item details without the | character.');
  }
  const matchingLegacyMasters = (await getDocs(query(collection(connection, 'operational_inventory_masters'), where('tenantId', '==', tenantId)))).docs
    .filter(snapshot => snapshot.id !== requestedMasterId && snapshot.data().inventoryClass === 'OPERATIONAL' &&
      operationalIdentityFingerprint(snapshot.data() as any) === fingerprint);
  if (matchingLegacyMasters.length) {
    throw new Error('A tenant-wide Operational item with the same name, category, type and issue unit already exists. Link this location to that item instead.');
  }

  await runTransaction(connection, async transaction => {
    const [settingsSnapshot, itemSnapshot, masterSnapshot, identityClaimSnapshot, openingMovementSnapshot, identityAuditSnapshot, identityStateSnapshot, counterSnapshot] = await Promise.all([
      transaction.get(settingsRef),
      transaction.get(itemRef),
      transaction.get(masterRef),
      transaction.get(identityClaimRef),
      transaction.get(openingMovementRef),
      transaction.get(identityAuditRef),
      transaction.get(identityStateRef),
      transaction.get(counterRef)
    ]);

    const settings = settingsSnapshot.data();
    if (!settingsSnapshot.exists() || settings?.tenantId !== tenantId || settings?.featureToggles?.enableOperationalInventory !== true) {
      throw new Error('Operational Inventory is disabled in System Settings.');
    }
    if (!identityStateSnapshot.exists() || identityStateSnapshot.data().tenantId !== tenantId || identityStateSnapshot.data().status !== 'READY') {
      throw new Error('The Operational item catalogue needs reconciliation before registration. Contact your system administrator.');
    }
    if (itemSnapshot.exists() && itemSnapshot.data().inventoryClass === 'SELLABLE') {
      throw new Error('Sellable inventory cannot be reclassified as Operational inventory.');
    }
    if (itemSnapshot.exists() && (itemSnapshot.data().tenantId !== tenantId || itemSnapshot.data().branchId !== branchId)) {
      throw new Error('The selected Operational location record belongs to another tenant or location.');
    }
    if (!input.itemId && itemSnapshot.exists()) {
      throw new Error('This Operational item already has a location record at the selected branch. Open that record instead.');
    }
    if (masterSnapshot.exists()) {
      const master = masterSnapshot.data();
      if (master.tenantId !== tenantId || master.inventoryClass !== 'OPERATIONAL') {
        throw new Error('The selected item identity is not an Operational item in this tenant.');
      }
      if (!input.itemId && !input.masterItemId) {
        throw new Error('A tenant-wide Operational item with the same identity already exists. Link this location to that item instead.');
      }
    } else if (input.masterItemId && !(itemSnapshot.exists() && input.masterItemId === itemRef.id)) {
      throw new Error('The selected tenant-wide Operational item identity no longer exists.');
    }
    const currentMaster = masterSnapshot.data() as OperationalInventoryMaster | undefined;
    if (currentMaster && operationalIdentityFingerprint(currentMaster as any) !== fingerprint) {
      throw new Error('This location does not match the selected tenant-wide Operational item identity. Choose the matching item or reconcile the identity first.');
    }
    if (identityClaimSnapshot.exists()) {
      const claim = identityClaimSnapshot.data();
      if (claim.tenantId !== tenantId || claim.inventoryClass !== 'OPERATIONAL' || claim.masterItemId !== masterItemId || claim.identityFingerprint !== fingerprint) {
        throw new Error('A tenant-wide Operational identity is already claimed by another master. Link the existing item instead.');
      }
    }
    const identityEventRequired = !itemSnapshot.exists() || !masterSnapshot.exists();
    if (identityAuditSnapshot.exists() && (identityAuditSnapshot.data().tenantId !== tenantId ||
        identityAuditSnapshot.data().itemId !== itemRef.id || identityAuditSnapshot.data().masterItemId !== masterItemId)) {
      throw new Error('An Operational identity audit record conflicts with this location. Reconcile before retrying.');
    }

    if (branchId === 'HQ' && currentMaster?.hqLocationItemId && currentMaster.hqLocationItemId !== itemRef.id) {
      throw new Error('This Operational item already has an HQ location record. Link the existing record instead of creating another.');
    }
    const shouldUpdateMaster = !currentMaster;
    const isBrandNewIdentity = !currentMaster && !input.itemId && !input.masterItemId;
    const generatedCode = isBrandNewIdentity
      ? formatSystemIdentity(codePrefix, Number(counterSnapshot.data()?.lastSequence || 0) + 1)
      : (currentMaster?.uniqueId || input.data.uniqueId || '');
    if (isBrandNewIdentity) {
      if (counterSnapshot.exists() && (counterSnapshot.data().tenantId !== tenantId || counterSnapshot.data().kind !== codeKind)) {
        throw new Error('Operational ID counter does not match this tenant and item class.');
      }
      transaction.set(counterRef, {
        tenantId, kind: codeKind,
        lastSequence: Number(counterSnapshot.data()?.lastSequence || 0) + 1,
        updatedAt: now
      });
    }
    const masterData: Omit<OperationalInventoryMaster, 'id'> = {
      tenantId,
      identityClaimId,
      ...masterFields(input.data, now),
      uniqueId: generatedCode,
      ...(branchId === 'HQ' ? { hqLocationItemId: itemRef.id } : {}),
      createdAt: currentMaster?.createdAt || now
    };
    const resolvedIdentity = currentMaster || ({ id: masterItemId, ...masterData } as OperationalInventoryMaster);
    const locationData = {
      ...input.data,
      quantityInStock: itemSnapshot.exists() ? itemSnapshot.data().quantityInStock : openingStock,
      ...(itemSnapshot.exists() && itemSnapshot.data().lastMovementId ? { lastMovementId: itemSnapshot.data().lastMovementId } : {}),
      ...(!itemSnapshot.exists() && Number(input.data.quantityInStock || 0) > 0 ? { lastMovementId: openingMovementRef.id } : {}),
      tenantId,
      branchId,
      masterItemId,
      inventoryClass: 'OPERATIONAL' as const,
      operationalType: resolvedIdentity.operationalType,
      type: resolvedIdentity.type,
      name: resolvedIdentity.name,
      category: resolvedIdentity.category,
      unitPerPack: resolvedIdentity.unitPerPack,
      unitOfIssue: resolvedIdentity.unitOfIssue,
      uniqueId: generatedCode,
      supplier: resolvedIdentity.supplier || input.data.supplier,
      updatedAt: now,
      ...(itemSnapshot.exists() ? {} : { createdAt: now })
    };

    if (shouldUpdateMaster) transaction.set(masterRef, masterData, { merge: true });
    else if (branchId === 'HQ' && !currentMaster?.hqLocationItemId) transaction.set(masterRef, { hqLocationItemId: itemRef.id, updatedAt: now }, { merge: true });
    if (!identityClaimSnapshot.exists()) transaction.set(identityClaimRef, {
      tenantId,
      inventoryClass: 'OPERATIONAL',
      identityFingerprint: fingerprint,
      masterItemId,
      actorId: input.actor.uid,
      createdAt: now
    });
    transaction.set(itemRef, locationData, { merge: true });
    if (identityEventRequired && !identityAuditSnapshot.exists()) {
      transaction.set(identityAuditRef, {
        tenantId,
        inventoryClass: 'OPERATIONAL',
        eventType: !itemSnapshot.exists() ? (currentMaster ? 'LOCATION_LINKED' : 'MASTER_CREATED') : 'LEGACY_ITEM_LINKED',
        itemId: itemRef.id,
        masterItemId,
        branchId,
        beforeMasterItemId: itemSnapshot.data()?.masterItemId || null,
        actorId: input.actor.uid,
        actorName: input.actor.name || '',
        createdAt: now
      });
    }
    if (!itemSnapshot.exists() && Number(input.data.quantityInStock || 0) > 0) {
      if (openingMovementSnapshot.exists()) throw new Error('An opening balance movement already exists for this Operational item. Reconcile before retrying.');
      const openingQuantity = Number(input.data.quantityInStock);
      if (!Number.isFinite(openingQuantity) || openingQuantity <= 0) throw new Error('The Operational opening stock quantity is invalid.');
      const unitCostUGX = Math.max(0, Number(input.data.costPerPack || input.data.cost || 0) / Math.max(1, Number(input.data.unitPerPack || 1)));
      transaction.set(openingMovementRef, {
        tenantId, inventoryClass: 'OPERATIONAL', operationalType: resolvedIdentity.operationalType,
        itemId: itemRef.id, masterItemId, itemName: resolvedIdentity.name,
        locationId: branchId === 'HQ' ? 'HQ_OPERATIONAL' : `BRANCH_${branchId}`,
        branchId,
        movementType: 'ADJUSTMENT', quantityDelta: openingQuantity,
        balanceBefore: 0, balanceAfter: openingQuantity, unitCostUGX,
        totalValueUGX: openingQuantity * unitCostUGX,
        reference: `OPENING-${itemRef.id}`, reason: 'Opening balance recorded during Operational item registration',
        idempotencyKey: openingMovementKey, actorId: input.actor.uid,
        actorName: input.actor.name || '',
        sourceTransactionId: itemRef.id, createdAt: now
      });
    }
  });

  return { itemId: itemRef.id, masterItemId };
}
