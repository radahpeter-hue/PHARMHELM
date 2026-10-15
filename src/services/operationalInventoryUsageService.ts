import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import { OperationalInventory, OperationalInventoryMaster, OperationalInventoryUsage } from '../types';
import { calculateOperationalUsage } from './operationalInventoryUsagePolicy';

export interface LogOperationalUsageInput {
  tenantId: string;
  branchId: string;
  itemId: string;
  quantity: number;
  department: string;
  recipient?: string;
  purpose: string;
  reference?: string;
  requestId: string;
  actor: { uid: string; name: string };
}

function hash(value: string): string {
  let code = 2166136261;
  for (let index = 0; index < value.length; index++) {
    code ^= value.charCodeAt(index);
    code = Math.imul(code, 16777619);
  }
  return (code >>> 0).toString(36);
}

function safeId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new Error('A valid usage request reference is required.');
  return value;
}

/** Atomically records consumption, a stock movement and the resulting balance. */
export async function logOperationalUsage(input: LogOperationalUsageInput): Promise<{ usageId: string; remainingStock: number; alreadyProcessed: boolean }> {
  const { tenantId, branchId, itemId, actor } = input;
  const quantity = Number(input.quantity);
  const department = input.department.trim();
  const purpose = input.purpose.trim();
  const reference = input.reference?.trim() || `OPU-${safeId(input.requestId)}`;
  const recipient = input.recipient?.trim() || '';
  if (!tenantId || !branchId || !itemId || !actor.uid || !actor.name.trim() || !department || !purpose) {
    throw new Error('Tenant, location, item, user, department and purpose are required.');
  }
  const requestId = safeId(input.requestId);
  const usageId = `opusage_${requestId}`;
  const payloadKey = [itemId, quantity, department, recipient, purpose, reference].join('|');
  const usageRef = doc(db, 'operational_inventory_usage', usageId);
  const movementKey = `usage_${hash(usageId)}`;
  const movementId = `opm_${movementKey}`;
  const movementRef = doc(db, 'operational_inventory_movements', movementId);
  const itemRef = doc(db, 'operational_inventory', itemId);
  const settingsRef = doc(db, 'system_settings', tenantId);
  const now = new Date().toISOString();

  return runTransaction(db, async transaction => {
    const [settingsSnapshot, itemSnapshot, usageSnapshot, movementSnapshot] = await Promise.all([
      transaction.get(settingsRef), transaction.get(itemRef), transaction.get(usageRef), transaction.get(movementRef)
    ]);
    const settings = settingsSnapshot.data();
    if (!settingsSnapshot.exists() || settings?.tenantId !== tenantId || settings?.featureToggles?.enableOperationalInventory !== true) {
      throw new Error('Operational Inventory is disabled in System Settings.');
    }
    if (!itemSnapshot.exists()) throw new Error('Operational Inventory item was not found.');
    const item = { id: itemSnapshot.id, ...itemSnapshot.data() } as OperationalInventory;
    if (item.tenantId !== tenantId || item.branchId !== branchId || (item.inventoryClass && item.inventoryClass !== 'OPERATIONAL')) {
      throw new Error('The item does not belong to this tenant and active Operational location.');
    }
    if (item.inventoryClass !== 'OPERATIONAL') throw new Error('The item has no verified Operational classification.');
    if (usageSnapshot.exists()) {
      const old = usageSnapshot.data();
      if (old.tenantId !== tenantId || old.inventoryId !== itemId || old.requestPayloadKey !== payloadKey || !movementSnapshot.exists()) {
        throw new Error('This usage request reference is already used by another transaction or needs reconciliation.');
      }
      return { usageId, remainingStock: Number(old.remainingStock), alreadyProcessed: true };
    }
    if (movementSnapshot.exists()) throw new Error('A stock movement already exists for this usage request. Reconcile before retrying.');

    const masterRef = doc(db, 'operational_inventory_masters', item.masterItemId || 'missing');
    const masterSnapshot = await transaction.get(masterRef);
    if (!item.masterItemId || !masterSnapshot.exists()) throw new Error('Link this Operational item to its master identity before logging usage.');
    const master = masterSnapshot.data() as OperationalInventoryMaster;
    if (master.tenantId !== tenantId || master.inventoryClass !== 'OPERATIONAL' || master.operationalType !== 'CONSUMABLE_OPERATIONAL') {
      throw new Error('Only verified Operational consumables can be issued through usage logging.');
    }
    const before = Number(item.quantityInStock || 0);
    const usageCalculation = calculateOperationalUsage(item, quantity);
    const after = usageCalculation.remainingStock;
    const unitCostUGX = usageCalculation.unitCostUGX;
    const cost = usageCalculation.totalCostUGX;
    const usage: Omit<OperationalInventoryUsage, 'id'> = {
      tenantId, inventoryClass: 'OPERATIONAL', operationalType: 'CONSUMABLE_OPERATIONAL',
      branchId, inventoryId: itemId, itemName: item.name, issuedAmount: quantity,
      unitOfIssue: item.unitOfIssue, unitCostUGX, cost, timestamp: now, period: 'daily',
      department, recipient, purpose, reference, remainingStock: after,
      movementId, idempotencyKey: requestId, requestPayloadKey: payloadKey,
      staffId: actor.uid, staffName: actor.name
    };
    transaction.update(itemRef, { inventoryClass: 'OPERATIONAL', operationalType: 'CONSUMABLE_OPERATIONAL', quantityInStock: after, lastMovementId: movementId, updatedAt: now });
    transaction.set(movementRef, {
      tenantId, inventoryClass: 'OPERATIONAL', itemId, masterItemId: master.id, itemName: item.name,
      locationId: branchId === 'HQ' ? 'HQ_OPERATIONAL' : `BRANCH_${branchId}`,
      branchId,
      movementType: 'USAGE', quantityDelta: -quantity, balanceBefore: before, balanceAfter: after,
      unitCostUGX, totalValueUGX: cost, reference, reason: purpose, idempotencyKey: movementKey,
      actorId: actor.uid, actorName: actor.name, sourceTransactionId: usageId, sourceLineId: usageId, createdAt: now
    });
    transaction.set(usageRef, usage);
    return { usageId, remainingStock: after, alreadyProcessed: false };
  });
}
