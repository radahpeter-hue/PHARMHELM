import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { auth, db } from '../../firebase';
import type { Sale, Staff } from '../../types';
import { normalizeDateValue } from '../../utils/dateValue';
import {
  buildPosV2RevisionLedgerEntry,
  type PosV2RevisionLedgerEntry
} from './posSaleRevisionV2Ledger';

export type PosV2RevisionLedgerScope =
  | { kind: 'BRANCH'; tenantId: string; branchId: string; actorUid: string }
  | { kind: 'GLOBAL'; tenantId: string; actorUid: string };

const clean = (value: unknown): string => String(value ?? '').trim();

function assertScope(scope: PosV2RevisionLedgerScope): void {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Authentication is required to view the revision ledger.');
  if (clean(currentUser.uid) !== clean(scope.actorUid)) {
    throw new Error('The authenticated user does not match the revision-ledger actor.');
  }
  if (!clean(scope.tenantId)) throw new Error('Revision-ledger tenant scope is required.');
  if (scope.kind === 'BRANCH' && !clean(scope.branchId)) {
    throw new Error('Revision-ledger branch scope is required.');
  }
}

async function loadSale(saleId: unknown): Promise<Sale | null> {
  const normalized = clean(saleId);
  if (!normalized) return null;
  const snapshot = await getDoc(doc(db, 'sales', normalized));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } as Sale : null;
}

/**
 * Reads the Admin-SDK-owned lifecycle records without creating, updating or
 * deleting revision evidence. Firestore rules independently enforce whether
 * the authenticated actor may read branch-scoped or tenant-wide results.
 */
export async function loadPosV2RevisionLedger(
  scope: PosV2RevisionLedgerScope,
  staff: Staff[] = []
): Promise<PosV2RevisionLedgerEntry[]> {
  assertScope(scope);

  const constraints = [where('tenantId', '==', clean(scope.tenantId))];
  if (scope.kind === 'BRANCH') constraints.push(where('branchId', '==', clean(scope.branchId)));

  const snapshot = await getDocs(query(collection(db, 'pos_sale_revision_requests'), ...constraints));
  const entries = await Promise.all(snapshot.docs.map(async requestSnapshot => {
    const request = { id: requestSnapshot.id, ...requestSnapshot.data() } as Record<string, unknown>;
    const [originalSale, replacementSale] = await Promise.all([
      loadSale(request.originalSaleId),
      loadSale(request.replacementSaleId || request.pendingReplacementSaleId)
    ]);

    return buildPosV2RevisionLedgerEntry({
      requestId: requestSnapshot.id,
      request,
      originalSale,
      replacementSale,
      staff
    });
  }));

  return entries.sort((left, right) => {
    const leftTime = normalizeDateValue(left.timestamps.completedAt || left.timestamps.updatedAt || left.timestamps.originalSaleAt)?.getTime() || 0;
    const rightTime = normalizeDateValue(right.timestamps.completedAt || right.timestamps.updatedAt || right.timestamps.originalSaleAt)?.getTime() || 0;
    return rightTime - leftTime;
  });
}
