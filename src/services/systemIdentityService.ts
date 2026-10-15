import { collection, doc, runTransaction, type Firestore, type Transaction } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Human-facing identifiers are independent of immutable Firestore document IDs.
 * Existing IDs and relationships must never be rewritten to apply a new code.
 * The counter is advanced atomically with the record creation.
 */
export function formatSystemIdentity(prefix: string, sequence: number): string {
  if (!/^[A-Z]{2,5}$/.test(prefix)) throw new Error('Invalid identity prefix.');
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('Invalid identity sequence.');
  return `${prefix}-${String(sequence).padStart(6, '0')}`;
}

export async function createTenantIdentity(
  data: Record<string, unknown>,
  connection: Firestore = db
): Promise<{ id: string; code: string }> {
  const tenantRef = doc(collection(connection, 'tenants'));
  const counterRef = doc(connection, 'identity_sequence_counters', 'platform_tenants');
  return runTransaction(connection, async transaction => {
    const current = await transaction.get(counterRef);
    const next = Number(current.data()?.lastSequence || 0) + 1;
    const code = formatSystemIdentity('TEN', next);
    transaction.set(counterRef, { scope: 'platform', kind: 'tenants', lastSequence: next, updatedAt: new Date().toISOString() });
    transaction.set(tenantRef, { ...data, tenant_code: code });
    return { id: tenantRef.id, code };
  });
}

export async function createBranchIdentity(
  tenantId: string,
  data: Record<string, unknown>,
  connection: Firestore = db
): Promise<{ id: string; code: string }> {
  if (!tenantId) throw new Error('Tenant is required to create a branch.');
  const branchRef = doc(collection(connection, 'branches'));
  const counterRef = doc(connection, 'identity_sequence_counters', `${tenantId}_branches`);
  return runTransaction(connection, async transaction => {
    const current = await transaction.get(counterRef);
    if (current.exists() && (current.data().tenantId !== tenantId || current.data().kind !== 'branches')) {
      throw new Error('Branch sequence belongs to a different tenant.');
    }
    const next = Number(current.data()?.lastSequence || 0) + 1;
    const code = formatSystemIdentity('BR', next);
    transaction.set(counterRef, { tenantId, kind: 'branches', lastSequence: next, updatedAt: new Date().toISOString() });
    transaction.set(branchRef, { ...data, tenantId, branch_code: code });
    return { id: branchRef.id, code };
  });
}
