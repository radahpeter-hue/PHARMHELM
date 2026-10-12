import { collection, doc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { db } from '../firebase';
import { OperationalInventory, OperationalInventoryMaster } from '../types';

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
    sku: data.sku,
    unitPerPack: data.unitPerPack,
    unitOfIssue: data.unitOfIssue,
    description: data.description,
    supplier: data.supplier,
    updatedAt: now
  };
}

/**
 * Saves the location record and its tenant-wide Operational item identity in
 * one transaction. Existing legacy records acquire a stable master identity
 * based on their current document ID when they are next edited.
 */
export async function saveOperationalLocationItem(input: SaveOperationalLocationItemInput): Promise<{ itemId: string; masterItemId: string }> {
  const tenantId = input.tenantId.trim();
  const branchId = input.branchId.trim();
  if (!tenantId || !branchId || !input.actor?.uid || !input.data.name.trim()) {
    throw new Error('Tenant, location, user and Operational item name are required.');
  }
  if (input.data.inventoryClass !== 'OPERATIONAL' || !['CONSUMABLE_OPERATIONAL', 'FIXED_ASSET'].includes(input.data.operationalType || '')) {
    throw new Error('Operational item classification is required.');
  }

  const itemRef = input.itemId
    ? doc(db, 'operational_inventory', input.itemId)
    : doc(collection(db, 'operational_inventory'));
  const masterItemId = input.masterItemId || input.itemId || itemRef.id;
  const masterRef = doc(db, 'operational_inventory_masters', masterItemId);
  const openingMovementKey = `op_opening_${itemRef.id}`;
  const openingMovementRef = doc(db, 'operational_inventory_movements', `opm_${openingMovementKey}`);
  const settingsRef = doc(db, 'system_settings', tenantId);
  const now = new Date().toISOString();
  const linkedLocationRefs = input.itemId && input.itemId === masterItemId
    ? (await getDocs(query(
        collection(db, 'operational_inventory'),
        where('tenantId', '==', tenantId),
        where('masterItemId', '==', masterItemId)
      ))).docs.map(snapshot => snapshot.ref)
    : [];

  await runTransaction(db, async transaction => {
    const [settingsSnapshot, itemSnapshot, masterSnapshot, openingMovementSnapshot] = await Promise.all([
      transaction.get(settingsRef),
      transaction.get(itemRef),
      transaction.get(masterRef),
      transaction.get(openingMovementRef)
    ]);

    const settings = settingsSnapshot.data();
    if (!settingsSnapshot.exists() || settings?.tenantId !== tenantId || settings?.featureToggles?.enableOperationalInventory !== true) {
      throw new Error('Operational Inventory is disabled in System Settings.');
    }
    if (itemSnapshot.exists() && (itemSnapshot.data().tenantId !== tenantId || itemSnapshot.data().branchId !== branchId)) {
      throw new Error('The selected Operational location record belongs to another tenant or location.');
    }
    if (masterSnapshot.exists()) {
      const master = masterSnapshot.data();
      if (master.tenantId !== tenantId || master.inventoryClass !== 'OPERATIONAL') {
        throw new Error('The selected item identity is not an Operational item in this tenant.');
      }
    } else if (input.masterItemId && !(itemSnapshot.exists() && input.masterItemId === itemRef.id)) {
      throw new Error('The selected tenant-wide Operational item identity no longer exists.');
    }

    const currentMaster = masterSnapshot.data() as OperationalInventoryMaster | undefined;
    if (branchId === 'HQ' && currentMaster?.hqLocationItemId && currentMaster.hqLocationItemId !== itemRef.id) {
      throw new Error('This Operational item already has an HQ location record. Link the existing record instead of creating another.');
    }
    const shouldUpdateMaster = !currentMaster || Boolean(input.itemId && input.itemId === masterItemId);
    const linkedLocationSnapshots = shouldUpdateMaster && currentMaster
      ? await Promise.all(linkedLocationRefs.map(ref => transaction.get(ref)))
      : [];
    const masterData: Omit<OperationalInventoryMaster, 'id'> = {
      tenantId,
      ...masterFields(input.data, now),
      ...(branchId === 'HQ' ? { hqLocationItemId: itemRef.id } : {}),
      createdAt: currentMaster?.createdAt || now
    };
    const resolvedIdentity = currentMaster || ({ id: masterItemId, ...masterData } as OperationalInventoryMaster);
    const locationData = {
      ...input.data,
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
      uniqueId: resolvedIdentity.uniqueId || input.data.uniqueId || '',
      supplier: resolvedIdentity.supplier || input.data.supplier,
      updatedAt: now,
      ...(itemSnapshot.exists() ? {} : { createdAt: now })
    };

    if (shouldUpdateMaster) transaction.set(masterRef, masterData, { merge: true });
    else if (branchId === 'HQ' && !currentMaster?.hqLocationItemId) transaction.set(masterRef, { hqLocationItemId: itemRef.id, updatedAt: now }, { merge: true });
    transaction.set(itemRef, locationData, { merge: true });
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
    if (linkedLocationSnapshots.length) {
      const sharedFields = {
        name: masterData.name,
        category: masterData.category,
        unitPerPack: masterData.unitPerPack,
        unitOfIssue: masterData.unitOfIssue,
        uniqueId: masterData.uniqueId,
        sku: masterData.sku,
        description: masterData.description,
        supplier: masterData.supplier,
        updatedAt: now
      };
      linkedLocationSnapshots
        .filter(snapshot => snapshot.exists())
        .filter(snapshot => snapshot.id !== itemRef.id)
        .forEach(snapshot => transaction.update(snapshot.ref, sharedFields));
    }
  });

  return { itemId: itemRef.id, masterItemId };
}
