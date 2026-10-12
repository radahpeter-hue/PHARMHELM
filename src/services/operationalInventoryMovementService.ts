import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import { OperationalInventory, OperationalInventoryMovement } from '../types';

export type OperationalStoreMovementType = OperationalInventoryMovement['movementType'];

export interface PostOperationalStoreMovementInput {
  tenantId: string;
  itemId: string;
  quantityDelta: number;
  movementType: OperationalStoreMovementType;
  reference: string;
  reason?: string;
  idempotencyKey: string;
  actorId: string;
  actorName?: string;
  sourceTransactionId?: string;
  sourceLineId?: string;
}

export interface PostOperationalStoreMovementResult {
  movementId: string;
  balanceBefore: number;
  balanceAfter: number;
  alreadyProcessed: boolean;
}

export function calculateOperationalBalance(currentBalance: number, quantityDelta: number): number {
  if (!Number.isFinite(currentBalance) || currentBalance < 0) {
    throw new Error('The current Operational Inventory balance is invalid.');
  }
  if (!Number.isFinite(quantityDelta) || quantityDelta === 0) {
    throw new Error('A non-zero finite quantity change is required.');
  }
  const nextBalance = currentBalance + quantityDelta;
  if (nextBalance < 0) throw new Error('The movement would reduce Operational Inventory below zero.');
  return nextBalance;
}

function movementDocumentId(idempotencyKey: string): string {
  const normalized = idempotencyKey.trim();
  if (!/^[A-Za-z0-9_-]{1,190}$/.test(normalized)) {
    throw new Error('A valid Operational Inventory idempotency key is required.');
  }
  return `opm_${normalized}`;
}

function assertMovementDirection(type: OperationalStoreMovementType, delta: number): void {
  const positiveTypes: OperationalStoreMovementType[] = ['RECEIPT', 'RETURN', 'TRANSFER_IN'];
  const negativeTypes: OperationalStoreMovementType[] = ['DISPATCH', 'TRANSFER_OUT', 'USAGE', 'WRITE_OFF'];
  if (positiveTypes.includes(type) && delta <= 0) throw new Error(`${type} must add stock.`);
  if (negativeTypes.includes(type) && delta >= 0) throw new Error(`${type} must reduce stock.`);
}

/**
 * Atomically changes an HQ Operational Store balance and appends its stock-card
 * event. The deterministic movement ID makes a retry return the original event
 * without applying the balance change again.
 */
export async function postOperationalStoreMovement(
  input: PostOperationalStoreMovementInput
): Promise<PostOperationalStoreMovementResult> {
  return postOperationalLocationMovement(input, 'HQ');
}

export async function postOperationalBranchMovement(
  input: PostOperationalStoreMovementInput,
  branchId: string
): Promise<PostOperationalStoreMovementResult> {
  if (!branchId || branchId === 'HQ') throw new Error('A real destination branch is required.');
  return postOperationalLocationMovement(input, branchId);
}

async function postOperationalLocationMovement(
  input: PostOperationalStoreMovementInput,
  expectedBranchId: string
): Promise<PostOperationalStoreMovementResult> {
  const tenantId = input.tenantId.trim();
  const reference = input.reference.trim();
  if (!tenantId || !input.itemId || !input.actorId || !reference) {
    throw new Error('Tenant, item, actor and movement reference are required.');
  }
  if (!Number.isFinite(input.quantityDelta) || input.quantityDelta === 0) {
    throw new Error('Enter a non-zero quantity change.');
  }
  if (input.movementType === 'ADJUSTMENT' && !input.reason?.trim()) {
    throw new Error('An adjustment reason is required.');
  }
  if (input.movementType === 'WRITE_OFF' && !input.reason?.trim()) {
    throw new Error('A write-off reason is required.');
  }
  assertMovementDirection(input.movementType, input.quantityDelta);

  const movementId = movementDocumentId(input.idempotencyKey);
  const itemRef = doc(db, 'operational_inventory', input.itemId);
  const movementRef = doc(db, 'operational_inventory_movements', movementId);
  const settingsRef = doc(db, 'system_settings', tenantId);

  return runTransaction(db, async transaction => {
    const [itemSnapshot, movementSnapshot, settingsSnapshot] = await Promise.all([
      transaction.get(itemRef),
      transaction.get(movementRef),
      transaction.get(settingsRef)
    ]);

    if (!itemSnapshot.exists()) throw new Error('Operational Inventory item was not found.');
    const item = { id: itemSnapshot.id, ...itemSnapshot.data() } as OperationalInventory;
    if (item.tenantId !== tenantId) throw new Error('The item belongs to another tenant.');
    if (item.branchId !== expectedBranchId) throw new Error('The Operational item is registered at a different location.');
    if (item.inventoryClass && item.inventoryClass !== 'OPERATIONAL') {
      throw new Error('The selected item is not classified as Operational Inventory.');
    }
    const resolvedMasterRef = doc(db, 'operational_inventory_masters', item.masterItemId || 'missing');
    const resolvedMasterSnapshot = await transaction.get(resolvedMasterRef);
    if (!item.masterItemId || !resolvedMasterSnapshot.exists() || resolvedMasterSnapshot.data().tenantId !== tenantId || resolvedMasterSnapshot.data().inventoryClass !== 'OPERATIONAL') {
      throw new Error('Link this legacy item to a tenant-wide Operational identity before posting stock movements.');
    }
    if (!settingsSnapshot.exists() || settingsSnapshot.data().tenantId !== tenantId || settingsSnapshot.data().featureToggles?.enableOperationalInventory !== true) {
      throw new Error('Operational Inventory is disabled in System Settings.');
    }

    if (movementSnapshot.exists()) {
      const existing = movementSnapshot.data() as OperationalInventoryMovement;
      if (existing.tenantId !== tenantId
        || existing.itemId !== item.id
        || existing.idempotencyKey !== input.idempotencyKey
        || existing.quantityDelta !== input.quantityDelta
        || existing.movementType !== input.movementType
        || existing.reference !== reference
        || existing.sourceTransactionId !== input.sourceTransactionId
        || existing.sourceLineId !== input.sourceLineId) {
        throw new Error('This movement reference is already used by another transaction.');
      }
      return {
        movementId,
        balanceBefore: existing.balanceBefore,
        balanceAfter: existing.balanceAfter,
        alreadyProcessed: true
      };
    }

    const balanceBefore = Number(item.quantityInStock || 0);
    const balanceAfter = calculateOperationalBalance(balanceBefore, input.quantityDelta);
    const unitCostUGX = Number(item.costPerPack || 0) / Math.max(1, Number(item.unitPerPack || 1));
    const movement: Omit<OperationalInventoryMovement, 'id'> = {
      tenantId,
      inventoryClass: 'OPERATIONAL',
      itemId: item.id,
      masterItemId: item.masterItemId,
      itemName: item.name,
      locationId: item.branchId === 'HQ' ? 'HQ_OPERATIONAL' : `BRANCH_${item.branchId}`,
      branchId: item.branchId,
      movementType: input.movementType,
      quantityDelta: input.quantityDelta,
      balanceBefore,
      balanceAfter,
      unitCostUGX,
      totalValueUGX: Math.abs(input.quantityDelta) * unitCostUGX,
      reference,
      ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
      idempotencyKey: input.idempotencyKey,
      actorId: input.actorId,
      ...(input.actorName ? { actorName: input.actorName } : {}),
      ...(input.sourceTransactionId ? { sourceTransactionId: input.sourceTransactionId } : {}),
      ...(input.sourceLineId ? { sourceLineId: input.sourceLineId } : {}),
      createdAt: new Date().toISOString()
    };

    transaction.update(itemRef, {
      inventoryClass: 'OPERATIONAL',
      operationalType: item.operationalType || (item.type === 'fixed' ? 'FIXED_ASSET' : 'CONSUMABLE_OPERATIONAL'),
      quantityInStock: balanceAfter,
      lastMovementId: movementId,
      updatedAt: new Date().toISOString()
    });
    transaction.set(movementRef, movement);
    return { movementId, balanceBefore, balanceAfter, alreadyProcessed: false };
  });
}
