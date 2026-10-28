import { staffRegistrationConflict } from '../utils/staffIdentityAudit';
import { collection, doc, getDocsFromServer, query, where, runTransaction, type Firestore, type Transaction } from 'firebase/firestore';
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

export const SCOPED_IDENTITY_KINDS = {
  clients: { kind: 'patients', field: 'patient_code', prefix: 'PAT' },
  prescribers: { kind: 'prescribers', field: 'prescriber_code', prefix: 'PRE' },
  institutions: { kind: 'institutions', field: 'institution_code', prefix: 'INS' },
  products: { kind: 'products', field: 'productId', prefix: 'PRD' },
  staff: { kind: 'staff', field: 'staff_code', prefix: 'STF' }
} as const;

export type ScopedIdentityCollection = keyof typeof SCOPED_IDENTITY_KINDS;

/** Register a new tenant-wide identity without accepting a caller-supplied business ID. */
export async function createScopedIdentity(
  collectionName: ScopedIdentityCollection,
  tenantId: string,
  data: Record<string, unknown>,
  connection: Firestore = db,
  documentId?: string
): Promise<{ id: string; code: string }> {
  if (!tenantId) throw new Error('Tenant is required to register an identity.');
  if (documentId && collectionName !== 'staff') throw new Error('Only a staff record may use its existing Auth UID as document ID.');
  const definition = SCOPED_IDENTITY_KINDS[collectionName];
  const counterRef = doc(connection, 'identity_sequence_counters', `${tenantId}_${definition.kind}`);
  const recordRef = documentId ? doc(connection, collectionName, documentId) : doc(collection(connection, collectionName));
  return runTransaction(connection, async transaction => {
    const current = await transaction.get(counterRef);
    const existingRecord = documentId ? await transaction.get(recordRef) : null;
    if (existingRecord?.exists()) throw new Error('A record already exists for this staff authentication identity.');
    if (current.exists() && (current.data().tenantId !== tenantId || current.data().kind !== definition.kind)) {
      throw new Error('Identity sequence has a different tenant or record type.');
    }
    if (collectionName === 'staff') {
      // Every registration path locks this tenant counter. If another HR writer
      // commits first, Firestore retries and this query sees their new employee.
      const register = await getDocsFromServer(query(collection(connection, 'staff'), where('tenantId', '==', tenantId)));
      const conflict = staffRegistrationConflict(data, register.docs.map(d => ({ ...d.data(), id: d.id, tenantId })));
      if (conflict) {
        const error = new Error(`This employee already has a staff record${conflict.staff_code ? ` (${conflict.staff_code})` : ''}. Open the existing HR record instead.`);
        error.name = 'StaffAlreadyExistsError'; throw error;
      }
    }
    const next = Number(current.data()?.lastSequence || 0) + 1;
    const code = formatSystemIdentity(definition.prefix, next);
    if (collectionName === 'staff') {
      const claimRef = doc(connection, 'staff_identity_claims', `${tenantId}_${code}`);
      if ((await transaction.get(claimRef)).exists()) throw new Error('Staff number already reserved; reconcile the staff sequence.');
      transaction.set(claimRef, { tenantId, staffId: recordRef.id, code, createdAt: new Date().toISOString() });
    }
    transaction.set(counterRef, { tenantId, kind: definition.kind, lastSequence: next, updatedAt: new Date().toISOString() });
    const payload: Record<string, unknown> = { ...data, tenantId, [definition.field]: code };
    if (collectionName === 'products') payload.sku = `SKU-${code.slice(4)}`;
    // Retain compatibility for newly registered staff while preserving every
    // existing historical employee_id during later staff-code backfills.
    if (collectionName === 'staff' && !String(data.employee_id || '').trim()) payload.employee_id = code;
    transaction.set(recordRef, payload);
    return { id: recordRef.id, code };
  });
}
