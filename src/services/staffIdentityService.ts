import { collection, doc, getDocs, query, runTransaction, where, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';
import { formatSystemIdentity } from './systemIdentityService';

/** Retry safe, tenant-wide allocation. Reservations survive staff departure/deletion. */
export async function ensureStaffIdentity(tenantId: string, staffId: string, connection: Firestore = db): Promise<string> {
  const staffRef = doc(connection, 'staff', staffId);
  const counterRef = doc(connection, 'identity_sequence_counters', `${tenantId}_staff`);
  return runTransaction(connection, async tx => {
    const staff = await tx.get(staffRef);
    if (!staff.exists() || staff.data().tenantId !== tenantId) throw new Error('Staff does not belong to this tenant.');
    // Archived activation aliases retain their number, but are never numbered as new people.
    if (staff.data().canonical_staff_id) return String(staff.data().staff_code || '');
    const existing = String(staff.data().staff_code || '').trim();
    const origin = staff.data().legacyStaffId || staffId;
    if (existing) {
      const claimRef = doc(connection, 'staff_identity_claims', `${tenantId}_${existing}`);
      const claim = await tx.get(claimRef);
      if (claim.exists()) {
        if (claim.data().staffId !== origin && claim.data().staffId !== staffId) throw new Error(`Staff number ${existing} is already reserved to another record.`);
      } else {
        // Legacy activated records may no longer have an original source document.
        // Reserve to the current immutable document; never fabricate an identity link.
        tx.set(claimRef, { tenantId, staffId, code: existing, createdAt: new Date().toISOString() });
      }
      return existing;
    }
    const counter = await tx.get(counterRef);
    if (counter.exists() && (counter.data().tenantId !== tenantId || counter.data().kind !== 'staff')) throw new Error('Invalid staff sequence scope.');
    const next = Number(counter.data()?.lastSequence || 0) + 1;
    const code = formatSystemIdentity('STF', next);
    const claimRef = doc(connection, 'staff_identity_claims', `${tenantId}_${code}`);
    const reserved = await tx.get(claimRef);
    if (reserved.exists()) throw new Error('Staff sequence conflicts with a reserved number. Reconcile the sequence before continuing.');
    tx.set(counterRef, { tenantId, kind: 'staff', lastSequence: next, updatedAt: new Date().toISOString() });
    tx.update(staffRef, { staff_code: code });
    tx.set(claimRef, { tenantId, staffId, code, createdAt: new Date().toISOString() });
    return code;
  });
}

/** Preflight before assigning any numbers; duplicate codes require explicit resolution. */
export async function backfillStaffIdentities(tenantId: string, connection: Firestore = db): Promise<number> {
  const snapshot = await getDocs(query(collection(connection, 'staff'), where('tenantId', '==', tenantId)));
  const records = snapshot.docs.filter(s => !s.data().canonical_staff_id);
  const used = new Map<string, string>();
  for (const record of records) {
    const code = String(record.data().staff_code || '').trim();
    if (code && used.has(code)) throw new Error(`Duplicate existing staff number ${code}. No backfill started.`);
    if (code) used.set(code, record.id);
  }
  // Reserve existing numbers first; the transaction rejects stale-counter collisions.
  records.sort((a, b) => Number(!!b.data().staff_code) - Number(!!a.data().staff_code) || a.id.localeCompare(b.id));
  let count = 0;
  for (const record of records) { await ensureStaffIdentity(tenantId, record.id, connection); count++; }
  return count;
}
