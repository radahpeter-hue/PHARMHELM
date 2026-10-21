import {collection, getDocs, query, where, type Firestore} from 'firebase/firestore';
import {auth, db} from '../firebase';
import {planFinanceV2AccountRegisterScope, type FinanceV2RegisterReader} from './financeV2AccountRegisterScope';

/**
 * Read-only Firebase Spark account register. Never writes balances.
 * Firestore Security Rules independently check tenant, role, and branch.
 * This endpoint is not yet wired to the Finance V2 release UI.
 */
export async function readFinanceV2AccountRegister(
  reader: FinanceV2RegisterReader,
  requestedBranchId?: string,
  connection: Firestore = db,
  delegatedRulesCertified = false
) {
  if (!auth.currentUser) throw new Error('Sign in required.');
  const scope = planFinanceV2AccountRegisterScope(reader, requestedBranchId, delegatedRulesCertified);
  const constraints = [
    where('tenantId', '==', scope.tenantId),
    where('controlVersion', '==', 2),
    ...(scope.branchId ? [where('branchId', '==', scope.branchId)] : []),
  ];
  const rows = await getDocs(query(collection(connection, 'finance_payment_accounts'), ...constraints));
  return rows.docs.map(row => ({documentId:row.id, ...row.data()}));
}
